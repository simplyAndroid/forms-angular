'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/// <reference path="../node_modules/@types/mongoose/index.d.ts" />
// This part of forms-angular borrows _very_ heavily from https://github.com/Alexandre-Strzelewicz/angular-bridge
// (now https://github.com/Unitech/angular-bridge
var _ = require('lodash');
var util = require('util');
var extend = require('node.extend');
var async = require('async');
var url = require('url');
var debug = false;
function logTheAPICalls(req, res, next) {
    void (res);
    console.log('API     : ' + req.method + ' ' + req.url + '  [ ' + JSON.stringify(req.body) + ' ]');
    next();
}
function processArgs(options, array) {
    if (options.authentication) {
        var authArray = _.isArray(options.authentication) ? options.authentication : [options.authentication];
        for (var i = authArray.length - 1; i >= 0; i--) {
            array.splice(1, 0, authArray[i]);
        }
    }
    if (debug) {
        array.splice(1, 0, logTheAPICalls);
    }
    array[0] = options.urlPrefix + array[0];
    return array;
}
var DataForm = function (mongoose, app, options) {
    this.app = app;
    app.locals.formsAngular = app.locals.formsAngular || [];
    app.locals.formsAngular.push(this);
    this.mongoose = mongoose;
    mongoose.set('debug', debug);
    mongoose.Promise = global.Promise;
    this.options = _.extend({
        urlPrefix: '/api/'
    }, options || {});
    this.resources = [];
    this.searchFunc = async.forEach;
    this.registerRoutes();
    this.app.get.apply(this.app, processArgs(this.options, ['search', this.searchAll()]));
    if (this.options.JQMongoFileUploader) {
        var JqUploadModule = this.options.JQMongoFileUploader.module || require('fng-jq-upload').Controller;
        this.fileUploader = new JqUploadModule(this, processArgs, this.options.JQMongoFileUploader);
        void (this.fileUploader); // suppress warning
    }
};
module.exports = exports = DataForm;
DataForm.prototype.getListFields = function (resource, doc, cb) {
    function getFirstMatchingField(keyList, type) {
        for (var i = 0; i < keyList.length; i++) {
            var fieldDetails = resource.model.schema['tree'][keyList[i]];
            if (fieldDetails.type && (!type || fieldDetails.type.name === type) && keyList[i] !== '_id') {
                resource.options.listFields = [{ field: keyList[i] }];
                return doc[keyList[i]];
            }
        }
    }
    var that = this;
    var display = '';
    var listFields = resource.options.listFields;
    if (listFields) {
        async.map(listFields, function (aField, cbm) {
            if (typeof doc[aField.field] !== 'undefined') {
                if (aField.params) {
                    if (aField.params.ref) {
                        var lookupResource = that.getResource(resource.model.schema['paths'][aField.field].options.ref);
                        if (lookupResource) {
                            var hiddenFields = that.generateHiddenFields(lookupResource, false);
                            hiddenFields.__v = 0;
                            lookupResource.model.findOne({ _id: doc[aField.field] }).select(hiddenFields).exec(function (err, doc2) {
                                if (err) {
                                    cbm(err);
                                }
                                else {
                                    that.getListFields(lookupResource, doc2, cbm);
                                }
                            });
                        }
                    }
                    else if (aField.params.params === 'timestamp') {
                        var record = doc[aField.field];
                        var timestamp = record.toString().substring(0, 8);
                        var date = new Date(parseInt(timestamp, 16) * 1000);
                        record = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                        cbm(null, record);
                    }
                }
                else {
                    cbm(null, doc[aField.field]);
                }
            }
            else {
                cbm(null, '');
            }
        }, function (err, results) {
            if (err) {
                cb(err);
            }
            else {
                if (results) {
                    cb(err, results.join(' ').trim());
                }
                else {
                    console.log('No results ' + listFields);
                }
            }
        });
    }
    else {
        var keyList = Object.keys(resource.model.schema['tree']);
        // No list field specified - use the first String field,
        display = getFirstMatchingField(keyList, 'String') ||
            // and if there aren't any then just take the first field
            getFirstMatchingField(keyList);
        cb(null, display.trim());
    }
};
/**
 * Registers all REST routes with the provided `app` object.
 */
DataForm.prototype.registerRoutes = function () {
    var search = 'search/', schema = 'schema/', report = 'report/', resourceName = ':resourceName', id = '/:id';
    this.app.get.apply(this.app, processArgs(this.options, ['models', this.models()]));
    this.app.get.apply(this.app, processArgs(this.options, [search + resourceName, this.search()]));
    this.app.get.apply(this.app, processArgs(this.options, [schema + resourceName, this.schema()]));
    this.app.get.apply(this.app, processArgs(this.options, [schema + resourceName + '/:formName', this.schema()]));
    this.app.get.apply(this.app, processArgs(this.options, [report + resourceName, this.report()]));
    this.app.get.apply(this.app, processArgs(this.options, [report + resourceName + '/:reportName', this.report()]));
    this.app.get.apply(this.app, processArgs(this.options, [resourceName, this.collectionGet()]));
    this.app.post.apply(this.app, processArgs(this.options, [resourceName, this.collectionPost()]));
    this.app.get.apply(this.app, processArgs(this.options, [resourceName + id, this.entityGet()]));
    this.app.post.apply(this.app, processArgs(this.options, [resourceName + id, this.entityPut()])); // You can POST or PUT to update data
    this.app.put.apply(this.app, processArgs(this.options, [resourceName + id, this.entityPut()]));
    this.app.delete.apply(this.app, processArgs(this.options, [resourceName + id, this.entityDelete()]));
    // return the List attributes for a record - used by select2
    this.app.get.apply(this.app, processArgs(this.options, [resourceName + id + '/list', this.entityList()]));
};
DataForm.prototype.newResource = function (model, options) {
    options = options || {};
    options.suppressDeprecatedMessage = true;
    var passModel = model;
    if (typeof model !== 'function') {
        passModel = model.model;
    }
    this.addResource(passModel.modelName, passModel, options);
};
//    Add a resource, specifying the model and any options.
//    Models may include their own options, which means they can be passed through from the model file
DataForm.prototype.addResource = function (resourceName, model, options) {
    var resource = {
        resourceName: resourceName,
        options: options || {}
    };
    if (!resource.options.suppressDeprecatedMessage) {
        console.log('addResource is deprecated - see https://github.com/forms-angular/forms-angular/issues/39');
    }
    if (typeof model === 'function') {
        resource.model = model;
    }
    else {
        resource.model = model.model;
        for (var prop in model) {
            if (model.hasOwnProperty(prop) && prop !== 'model') {
                resource.options[prop] = model[prop];
            }
        }
    }
    extend(resource.options, this.preprocess(resource, resource.model.schema['paths'], null));
    if (resource.options.searchImportance) {
        this.searchFunc = async.forEachSeries;
    }
    if (this.searchFunc === async.forEachSeries) {
        this.resources.splice(_.sortedIndexBy(this.resources, resource, function (obj) {
            return obj.options.searchImportance || 99;
        }), 0, resource);
    }
    else {
        this.resources.push(resource);
    }
};
DataForm.prototype.getResource = function (name) {
    return _.find(this.resources, function (resource) {
        return resource.resourceName === name;
    });
};
DataForm.prototype.internalSearch = function (req, resourcesToSearch, includeResourceInResults, limit, callback) {
    var searches = [], resourceCount = resourcesToSearch.length, urlParts = url.parse(req.url, true), searchFor = urlParts.query.q, filter = urlParts.query.f;
    function translate(string, array, context) {
        if (array) {
            var translation = _.find(array, function (fromTo) {
                return fromTo.from === string && (!fromTo.context || fromTo.context === context);
            });
            if (translation) {
                string = translation.to;
            }
        }
        return string;
    }
    // return a string that determines the sort order of the resultObject
    function calcResultValue(obj) {
        function padLeft(score, reqLength, str) {
            if (str === void 0) { str = '0'; }
            return new Array(1 + reqLength - String(score).length).join(str) + score;
        }
        var sortString = '';
        sortString += padLeft(obj.addHits || 9, 1);
        sortString += padLeft(obj.searchImportance || 99, 2);
        sortString += padLeft(obj.weighting || 9999, 4);
        sortString += obj.text;
        return sortString;
    }
    if (filter) {
        filter = JSON.parse(filter);
    }
    for (var i = 0; i < resourceCount; i++) {
        var resource = resourcesToSearch[i];
        if (resource.options.searchImportance !== false) {
            var schema = resource.model.schema;
            var indexedFields = [];
            for (var j = 0; j < schema._indexes.length; j++) {
                var attributes = schema._indexes[j][0];
                var field = Object.keys(attributes)[0];
                if (indexedFields.indexOf(field) === -1) {
                    indexedFields.push(field);
                }
            }
            for (var path in schema.paths) {
                if (path !== '_id' && schema.paths.hasOwnProperty(path)) {
                    if (schema.paths[path]._index && !schema.paths[path].options.noSearch) {
                        if (indexedFields.indexOf(path) === -1) {
                            indexedFields.push(path);
                        }
                    }
                }
            }
            if (indexedFields.length === 0) {
                console.log('ERROR: Searching on a collection with no indexes ' + resource.resourceName);
            }
            for (var m = 0; m < indexedFields.length; m++) {
                searches.push({ resource: resource, field: indexedFields[m] });
            }
        }
    }
    var that = this, results = [], moreCount = 0, searchCriteria;
    // Removed the logic that preserved spaces when collection was specified because Louise asked me to.
    searchCriteria = { $regex: '^(' + searchFor.split(' ').join('|') + ')', $options: 'i' };
    this.searchFunc(searches, function (item, cb) {
        var searchDoc = {};
        if (filter) {
            extend(searchDoc, filter);
            if (filter[item.field]) {
                delete searchDoc[item.field];
                var obj1 = {}, obj2 = {};
                obj1[item.field] = filter[item.field];
                obj2[item.field] = searchCriteria;
                searchDoc['$and'] = [obj1, obj2];
            }
            else {
                searchDoc[item.field] = searchCriteria;
            }
        }
        else {
            searchDoc[item.field] = searchCriteria;
        }
        // The +60 in the next line is an arbitrary safety zone for situations where items that match the string
        // in more than one index get filtered out.
        // TODO : Figure out a better way to deal with this
        that.filteredFind(item.resource, req, null, searchDoc, item.resource.options.searchOrder, limit + 60, null, function (err, docs) {
            if (!err && docs && docs.length > 0) {
                async.map(docs, function (aDoc, cbdoc) {
                    // Do we already have them in the list?
                    var thisId = aDoc._id.toString(), resultObject, resultPos;
                    function handleResultsInList() {
                        resultObject.searchImportance = item.resource.options.searchImportance || 99;
                        if (item.resource.options.localisationData) {
                            resultObject.resource = translate(resultObject.resource, item.resource.options.localisationData, 'resource');
                            resultObject.resourceText = translate(resultObject.resourceText, item.resource.options.localisationData, 'resourceText');
                            resultObject.resourceTab = translate(resultObject.resourceTab, item.resource.options.localisationData, 'resourceTab');
                        }
                        results.splice(_.sortedIndexBy(results, resultObject, calcResultValue), 0, resultObject);
                        cbdoc(null);
                    }
                    for (resultPos = results.length - 1; resultPos >= 0; resultPos--) {
                        if (results[resultPos].id.toString() === thisId) {
                            break;
                        }
                    }
                    if (resultPos >= 0) {
                        resultObject = {};
                        extend(resultObject, results[resultPos]);
                        // If they have already matched then improve their weighting
                        resultObject.addHits = Math.max((resultObject.addHits || 9) - 1, 1);
                        // remove it from current position
                        results.splice(resultPos, 1);
                        // and re-insert where appropriate
                        results.splice(_.sortedIndexBy(results, resultObject, calcResultValue), 0, resultObject);
                        cbdoc(null);
                    }
                    else {
                        // Otherwise add them new...
                        // Use special listings format if defined
                        var specialListingFormat = item.resource.options.searchResultFormat;
                        if (specialListingFormat) {
                            resultObject = specialListingFormat.apply(aDoc);
                            handleResultsInList();
                        }
                        else {
                            that.getListFields(item.resource, aDoc, function (err, description) {
                                if (err) {
                                    cbdoc(err);
                                }
                                else {
                                    resultObject = {
                                        id: aDoc._id,
                                        weighting: 9999,
                                        text: description
                                    };
                                    if (resourceCount > 1 || includeResourceInResults) {
                                        resultObject.resource = resultObject.resourceText = item.resource.resourceName;
                                    }
                                    handleResultsInList();
                                }
                            });
                        }
                    }
                }, function (err) {
                    cb(err);
                });
            }
            else {
                cb(err);
            }
        });
    }, function () {
        // Strip weighting from the results
        results = _.map(results, function (aResult) {
            delete aResult.weighting;
            return aResult;
        });
        if (results.length > limit) {
            moreCount += results.length - limit;
            results.splice(limit);
        }
        callback({ results: results, moreCount: moreCount });
    });
};
DataForm.prototype.search = function () {
    return _.bind(function (req, res, next) {
        if (!(req.resource = this.getResource(req.params.resourceName))) {
            return next();
        }
        this.internalSearch(req, [req.resource], false, 10, function (resultsObject) {
            res.send(resultsObject);
        });
    }, this);
};
DataForm.prototype.searchAll = function () {
    return _.bind(function (req, res) {
        this.internalSearch(req, this.resources, true, 10, function (resultsObject) {
            res.send(resultsObject);
        });
    }, this);
};
DataForm.prototype.models = function () {
    var that = this;
    return function (req, res) {
        //    TODO: Make this less wasteful - we only need to send the resourceNames of the resources
        // Check for optional modelFilter and call it with the request and current list.  Otherwise just return the list.
        res.send(that.options.modelFilter ? that.options.modelFilter.call(null, req, that.resources) : that.resources);
    };
};
DataForm.prototype.renderError = function (err, redirectUrl, req, res) {
    if (typeof err === 'string') {
        res.send(err);
    }
    else {
        res.send(err.message);
    }
};
DataForm.prototype.redirect = function (address, req, res) {
    res.send(address);
};
DataForm.prototype.applySchemaSubset = function (vanilla, schema) {
    var outPath;
    if (schema) {
        outPath = {};
        for (var fld in schema) {
            if (schema.hasOwnProperty(fld)) {
                if (!vanilla[fld]) {
                    throw new Error('No such field as ' + fld + '.  Is it part of a sub-doc? If so you need the bit before the period.');
                }
                outPath[fld] = vanilla[fld];
                if (vanilla[fld].schema) {
                    outPath[fld].schema = this.applySchemaSubset(outPath[fld].schema, schema[fld].schema);
                }
                outPath[fld].options = outPath[fld].options || {};
                for (var override in schema[fld]) {
                    if (schema[fld].hasOwnProperty(override)) {
                        if (!outPath[fld].options.form) {
                            outPath[fld].options.form = {};
                        }
                        outPath[fld].options.form[override] = schema[fld][override];
                    }
                }
            }
        }
    }
    else {
        outPath = vanilla;
    }
    return outPath;
};
DataForm.prototype.preprocess = function (resource, paths, formSchema) {
    var outPath = {}, hiddenFields = [], listFields = [];
    if (resource && resource.options && resource.options.idIsList) {
        paths['_id'].options = paths['_id'].options || {};
        paths['_id'].options.list = resource.options.idIsList;
    }
    for (var element in paths) {
        if (paths.hasOwnProperty(element) && element !== '__v') {
            // check for schemas
            if (paths[element].schema) {
                var subSchemaInfo = this.preprocess(null, paths[element].schema.paths);
                outPath[element] = { schema: subSchemaInfo.paths };
                if (paths[element].options.form) {
                    outPath[element].options = { form: extend(true, {}, paths[element].options.form) };
                }
            }
            else {
                // check for arrays
                var realType = paths[element].caster ? paths[element].caster : paths[element];
                if (!realType.instance) {
                    if (realType.options.type) {
                        var type = realType.options.type(), typeType = typeof type;
                        if (typeType === 'string') {
                            realType.instance = (!isNaN(Date.parse(type))) ? 'Date' : 'String';
                        }
                        else {
                            realType.instance = typeType;
                        }
                    }
                }
                outPath[element] = extend(true, {}, paths[element]);
                if (paths[element].options.secure) {
                    hiddenFields.push(element);
                }
                if (paths[element].options.match) {
                    outPath[element].options.match = paths[element].options.match.source;
                }
                var schemaListInfo = paths[element].options.list;
                if (schemaListInfo) {
                    var listFieldInfo = { field: element };
                    if (typeof schemaListInfo === 'object' && Object.keys(schemaListInfo).length > 0) {
                        listFieldInfo.params = schemaListInfo;
                    }
                    listFields.push(listFieldInfo);
                }
            }
        }
    }
    outPath = this.applySchemaSubset(outPath, formSchema);
    var returnObj = { paths: outPath };
    if (hiddenFields.length > 0) {
        returnObj.hide = hiddenFields;
    }
    if (listFields.length > 0) {
        returnObj.listFields = listFields;
    }
    return returnObj;
};
DataForm.prototype.schema = function () {
    return _.bind(function (req, res) {
        if (!(req.resource = this.getResource(req.params.resourceName))) {
            return res.status(404).end();
        }
        var formSchema = null;
        if (req.params.formName) {
            formSchema = req.resource.model.schema.statics['form'](req.params.formName);
        }
        var paths = this.preprocess(req.resource, req.resource.model.schema.paths, formSchema).paths;
        res.send(paths);
    }, this);
};
DataForm.prototype.report = function () {
    return _.bind(function (req, res, next) {
        if (!(req.resource = this.getResource(req.params.resourceName))) {
            return next();
        }
        var reportSchema, self = this, urlParts = url.parse(req.url, true);
        if (req.params.reportName) {
            reportSchema = req.resource.model.schema.statics['report'](req.params.reportName, req);
        }
        else if (urlParts.query.r) {
            switch (urlParts.query.r[0]) {
                case '[':
                    reportSchema = { pipeline: JSON.parse(urlParts.query.r) };
                    break;
                case '{':
                    reportSchema = JSON.parse(urlParts.query.r);
                    break;
                default:
                    return self.renderError(new Error('Invalid "r" parameter'), null, req, res, next);
            }
        }
        else {
            var fields = {};
            for (var key in req.resource.model.schema.paths) {
                if (req.resource.model.schema.paths.hasOwnProperty(key)) {
                    if (key !== '__v' && !req.resource.model.schema.paths[key].options.secure) {
                        if (key.indexOf('.') === -1) {
                            fields[key] = 1;
                        }
                    }
                }
            }
            reportSchema = { pipeline: [
                    { $project: fields }
                ], drilldown: req.params.resourceName + '/|_id|/edit' };
        }
        // Replace parameters in pipeline
        var schemaCopy = {};
        extend(schemaCopy, reportSchema);
        schemaCopy.params = schemaCopy.params || [];
        self.reportInternal(req, req.resource, schemaCopy, urlParts, function (err, result) {
            if (err) {
                self.renderError(err, null, req, res, next);
            }
            else {
                res.send(result);
            }
        });
    }, this);
};
DataForm.prototype.hackVariablesInPipeline = function (runPipeline) {
    for (var pipelineSection = 0; pipelineSection < runPipeline.length; pipelineSection++) {
        if (runPipeline[pipelineSection]['$match']) {
            this.hackVariables(runPipeline[pipelineSection]['$match']);
        }
    }
};
DataForm.prototype.hackVariables = function (obj) {
    // Replace variables that cannot be serialised / deserialised.  Bit of a hack, but needs must...
    // Anything formatted 1800-01-01T00:00:00.000Z or 1800-01-01T00:00:00.000+0000 is converted to a Date
    // Only handles the cases I need for now
    // TODO: handle arrays etc
    for (var prop in obj) {
        if (obj.hasOwnProperty(prop)) {
            if (typeof obj[prop] === 'string') {
                var dateTest = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3})(Z|[+ -]\d{4})$/.exec(obj[prop]);
                if (dateTest) {
                    obj[prop] = new Date(dateTest[1] + 'Z');
                }
                else {
                    var objectIdTest = /^([0-9a-fA-F]{24})$/.exec(obj[prop]);
                    if (objectIdTest) {
                        obj[prop] = new this.mongoose.Schema.Types.ObjectId(objectIdTest[1]);
                    }
                }
            }
            else if (_.isObject(obj[prop])) {
                this.hackVariables(obj[prop]);
            }
        }
    }
};
DataForm.prototype.reportInternal = function (req, resource, schema, options, callback) {
    var runPipeline;
    var self = this;
    self.doFindFunc(req, resource, function (err, queryObj) {
        if (err) {
            return 'There was a problem with the findFunc for model';
        }
        else {
            // Bit crap here switching back and forth to string
            runPipeline = JSON.stringify(schema.pipeline);
            for (var param in options.query) {
                if (options.query[param]) {
                    if (param !== 'r') {
                        schema.params[param].value = options.query[param];
                    }
                }
            }
            // Replace parameters with the value
            if (runPipeline) {
                runPipeline = runPipeline.replace(/\"\(.+?\)\"/g, function (match) {
                    var sparam = schema.params[match.slice(2, -2)];
                    if (sparam.type === 'number') {
                        return sparam.value;
                    }
                    else if (_.isObject(sparam.value)) {
                        return JSON.stringify(sparam.value);
                    }
                    else if (sparam.value[0] === '{') {
                        return sparam.value;
                    }
                    else {
                        return '"' + sparam.value + '"';
                    }
                });
            }
            // Don't send the 'secure' fields
            var hiddenFields = self.generateHiddenFields(resource, false);
            for (var hiddenField in hiddenFields) {
                if (hiddenFields.hasOwnProperty(hiddenField)) {
                    if (runPipeline.indexOf(hiddenField) !== -1) {
                        return callback('You cannot access ' + hiddenField);
                    }
                }
            }
            runPipeline = JSON.parse(runPipeline);
            self.hackVariablesInPipeline(runPipeline);
            // Add the findFunc query to the pipeline
            if (queryObj) {
                runPipeline.unshift({ $match: queryObj });
            }
            var toDo = {
                runAggregation: function (cb) {
                    resource.model.aggregate(runPipeline, cb);
                }
            };
            var translations = []; // array of form {ref:'lookupname',translations:[{value:xx, display:'  '}]}
            // if we need to do any column translations add the function to the tasks list
            if (schema.columnTranslations) {
                toDo.applyTranslations = ['runAggregation', function (cb, results) {
                        function doATranslate(column, theTranslation) {
                            results['runAggregation'].forEach(function (resultRow) {
                                var valToTranslate = resultRow[column.field];
                                valToTranslate = (valToTranslate ? valToTranslate.toString() : '');
                                var thisTranslation = _.find(theTranslation.translations, function (option) {
                                    return valToTranslate === option.value.toString();
                                });
                                resultRow[column.field] = thisTranslation ? thisTranslation.display : ' * Missing columnTranslation * ';
                            });
                        }
                        schema.columnTranslations.forEach(function (columnTranslation) {
                            if (columnTranslation.translations) {
                                doATranslate(columnTranslation, columnTranslation);
                            }
                            if (columnTranslation.ref) {
                                var theTranslation = _.find(translations, function (translation) {
                                    return (translation.ref === columnTranslation.ref);
                                });
                                if (theTranslation) {
                                    doATranslate(columnTranslation, theTranslation);
                                }
                                else {
                                    cb('Invalid ref property of ' + columnTranslation.ref + ' in columnTranslations ' + columnTranslation.field);
                                }
                            }
                        });
                        cb(null, null);
                    }];
                var callFuncs = false;
                for (var i = 0; i < schema.columnTranslations.length; i++) {
                    var thisColumnTranslation = schema.columnTranslations[i];
                    if (thisColumnTranslation.field) {
                        // if any of the column translations are adhoc funcs, set up the tasks to perform them
                        if (thisColumnTranslation.fn) {
                            callFuncs = true;
                        }
                        // if this column translation is a "ref", set up the tasks to look up the values and populate the translations
                        if (thisColumnTranslation.ref) {
                            var lookup = self.getResource(thisColumnTranslation.ref);
                            if (lookup) {
                                if (!toDo[thisColumnTranslation.ref]) {
                                    var getFunc = function (ref) {
                                        var lookup = ref;
                                        return function (cb) {
                                            var translateObject = { ref: lookup.resourceName, translations: [] };
                                            translations.push(translateObject);
                                            lookup.model.find({}, {}, { lean: true }, function (err, findResults) {
                                                if (err) {
                                                    cb(err);
                                                }
                                                else {
                                                    // TODO - this ref func can probably be done away with now that list fields can have ref
                                                    var j = 0;
                                                    async.whilst(function () { return j < findResults.length; }, function (cbres) {
                                                        var theResult = findResults[j];
                                                        translateObject.translations[j] = translateObject.translations[j] || {};
                                                        var theTranslation = translateObject.translations[j];
                                                        j++;
                                                        self.getListFields(lookup, theResult, function (err, description) {
                                                            if (err) {
                                                                cbres(err);
                                                            }
                                                            else {
                                                                theTranslation.value = theResult._id;
                                                                theTranslation.display = description;
                                                                cbres(null);
                                                            }
                                                        });
                                                    }, cb);
                                                }
                                            });
                                        };
                                    };
                                    toDo[thisColumnTranslation.ref] = getFunc(lookup);
                                    toDo.applyTranslations.unshift(thisColumnTranslation.ref); // Make sure we populate lookup before doing translation
                                }
                            }
                            else {
                                return callback('Invalid ref property of ' + thisColumnTranslation.ref + ' in columnTranslations ' + thisColumnTranslation.field);
                            }
                        }
                        if (!thisColumnTranslation.translations && !thisColumnTranslation.ref && !thisColumnTranslation.fn) {
                            return callback('A column translation needs a ref, fn or a translations property - ' + thisColumnTranslation.field + ' has neither');
                        }
                    }
                    else {
                        return callback('A column translation needs a field property');
                    }
                }
                if (callFuncs) {
                    toDo['callFunctions'] = ['runAggregation', function (cb, results) {
                            async.each(results.runAggregation, function (row, cb) {
                                for (var i = 0; i < schema.columnTranslations.length; i++) {
                                    var thisColumnTranslation = schema.columnTranslations[i];
                                    if (thisColumnTranslation.fn) {
                                        thisColumnTranslation.fn(row, cb);
                                    }
                                }
                            }, function () {
                                cb(null);
                            });
                        }];
                    toDo.applyTranslations.unshift('callFunctions'); // Make sure we do function before translating its result
                }
            }
            async.auto(toDo, function (err, results) {
                if (err) {
                    callback(err);
                }
                else {
                    // TODO: Could loop through schema.params and just send back the values
                    callback(null, { success: true, schema: schema, report: results.runAggregation, paramsUsed: schema.params });
                }
            });
        }
    });
};
DataForm.prototype.saveAndRespond = function (req, res, hiddenFields) {
    function internalSave(doc) {
        doc.save(function (err, doc2) {
            if (err) {
                var err2 = { status: 'err' };
                if (!err.errors) {
                    err2.message = err.message;
                }
                else {
                    extend(err2, err);
                }
                if (debug) {
                    console.log('Error saving record: ' + JSON.stringify(err2));
                }
                res.status(400).send(err2);
            }
            else {
                doc2 = doc2.toObject();
                for (var hiddenField in hiddenFields) {
                    if (hiddenFields.hasOwnProperty(hiddenField) && hiddenFields[hiddenField]) {
                        var parts = hiddenField.split('.');
                        var lastPart = parts.length - 1;
                        var target = doc2;
                        for (var i = 0; i < lastPart; i++) {
                            if (target.hasOwnProperty(parts[i])) {
                                target = target[parts[i]];
                            }
                        }
                        if (target.hasOwnProperty(parts[lastPart])) {
                            delete target[parts[lastPart]];
                        }
                    }
                }
                res.send(doc2);
            }
        });
    }
    var doc = req.doc;
    if (typeof req.resource.options.onSave === 'function') {
        req.resource.options.onSave(doc, req, function (err) {
            if (err) {
                throw err;
            }
            internalSave(doc);
        });
    }
    else {
        internalSave(doc);
    }
};
/**
 * All entities REST functions have to go through this first.
 */
DataForm.prototype.processCollection = function (req) {
    req.resource = this.getResource(req.params.resourceName);
};
/**
 * Renders a view with the list of docs, which may be modified by query parameters
 */
DataForm.prototype.collectionGet = function () {
    return _.bind(function (req, res, next) {
        this.processCollection(req);
        if (!req.resource) {
            return next();
        }
        var urlParts = url.parse(req.url, true);
        try {
            var aggregationParam = urlParts.query.a ? JSON.parse(urlParts.query.a) : null;
            var findParam = urlParts.query.f ? JSON.parse(urlParts.query.f) : {};
            var limitParam = urlParts.query.l ? JSON.parse(urlParts.query.l) : 0;
            var skipParam = urlParts.query.s ? JSON.parse(urlParts.query.s) : 0;
            var orderParam = urlParts.query.o ? JSON.parse(urlParts.query.o) : req.resource.options.listOrder;
            // Dates in aggregation must be Dates
            if (aggregationParam) {
                this.hackVariablesInPipeline(aggregationParam);
            }
            var self = this;
            this.filteredFind(req.resource, req, aggregationParam, findParam, orderParam, limitParam, skipParam, function (err, docs) {
                if (err) {
                    return self.renderError(err, null, req, res, next);
                }
                else {
                    res.send(docs);
                }
            });
        }
        catch (e) {
            res.send(e);
        }
    }, this);
};
DataForm.prototype.doFindFunc = function (req, resource, cb) {
    if (resource.options.findFunc) {
        resource.options.findFunc(req, cb);
    }
    else {
        cb(null);
    }
};
DataForm.prototype.filteredFind = function (resource, req, aggregationParam, findParam, sortOrder, limit, skip, callback) {
    var that = this, hiddenFields = this.generateHiddenFields(resource, false);
    function doAggregation(cb) {
        if (aggregationParam) {
            resource.model.aggregate(aggregationParam, function (err, aggregationResults) {
                if (err) {
                    throw err;
                }
                else {
                    cb(_.map(aggregationResults, function (obj) {
                        return obj._id;
                    }));
                }
            });
        }
        else {
            cb([]);
        }
    }
    doAggregation(function (idArray) {
        if (aggregationParam && idArray.length === 0) {
            callback(null, []);
        }
        else {
            that.doFindFunc(req, resource, function (err, queryObj) {
                if (err) {
                    callback(err);
                }
                else {
                    var query = resource.model.find(queryObj);
                    if (idArray.length > 0) {
                        query = query.where('_id').in(idArray);
                    }
                    query = query.find(findParam).select(hiddenFields);
                    if (limit) {
                        query = query.limit(limit);
                    }
                    if (skip) {
                        query = query.skip(skip);
                    }
                    if (sortOrder) {
                        query = query.sort(sortOrder);
                    }
                    query.exec(callback);
                }
            });
        }
    });
};
DataForm.prototype.collectionPost = function () {
    return _.bind(function (req, res, next) {
        this.processCollection(req);
        if (!req.resource) {
            next();
            return;
        }
        if (!req.body) {
            throw new Error('Nothing submitted.');
        }
        var cleansedBody = this.cleanseRequest(req);
        req.doc = new req.resource.model(cleansedBody);
        this.saveAndRespond(req, res);
    }, this);
};
/**
 * Generate an object of fields to not expose
 **/
DataForm.prototype.generateHiddenFields = function (resource, state) {
    var hiddenFields = {};
    if (resource.options['hide'] !== undefined) {
        resource.options.hide.forEach(function (dt) {
            hiddenFields[dt] = state;
        });
    }
    return hiddenFields;
};
/** Sec issue
 * Cleanse incoming data to avoid overwrite and POST request forgery
 * (name may seem weird but it was in French, so it is some small improvement!)
 */
DataForm.prototype.cleanseRequest = function (req) {
    var reqData = req.body, resource = req.resource;
    delete reqData.__v; // Don't mess with Mongoose internal field (https://github.com/LearnBoost/mongoose/issues/1933)
    if (typeof resource.options['hide'] === 'undefined') {
        return reqData;
    }
    var hiddenFields = resource.options.hide;
    _.each(reqData, function (num, key) {
        _.each(hiddenFields, function (fi) {
            if (fi === key) {
                delete reqData[key];
            }
        });
    });
    return reqData;
};
DataForm.prototype.generateQueryForEntity = function (req, resource, id, cb) {
    var hiddenFields = this.generateHiddenFields(resource, false);
    hiddenFields.__v = 0;
    this.doFindFunc(req, resource, function (err, queryObj) {
        if (err) {
            cb(err);
        }
        else {
            var idSel = { _id: id };
            var crit = queryObj ? extend(queryObj, idSel) : idSel;
            cb(null, resource.model.findOne(crit).select(hiddenFields));
        }
    });
};
/*
 * Entity request goes there first
 * It retrieves the resource
 */
DataForm.prototype.processEntity = function (req, res, next) {
    if (!(req.resource = this.getResource(req.params.resourceName))) {
        next();
        return;
    }
    this.generateQueryForEntity(req, req.resource, req.params.id, function (err, query) {
        if (err) {
            return res.send({
                success: false,
                err: util.inspect(err)
            });
        }
        else {
            query.exec(function (err, doc) {
                if (err) {
                    return res.send({
                        success: false,
                        err: util.inspect(err)
                    });
                }
                else if (doc == null) {
                    return res.send({
                        success: false,
                        err: 'Record not found'
                    });
                }
                req.doc = doc;
                next();
            });
        }
    });
};
/**
 * Gets a single entity
 *
 * @return {Function} The function to use as route
 */
DataForm.prototype.entityGet = function () {
    return _.bind(function (req, res, next) {
        this.processEntity(req, res, function () {
            if (!req.resource) {
                return next();
            }
            return res.send(req.doc);
        });
    }, this);
};
DataForm.prototype.replaceHiddenFields = function (record, data) {
    var self = this;
    if (record) {
        record._replacingHiddenFields = true;
        _.each(data, function (value, name) {
            if (_.isObject(value)) {
                self.replaceHiddenFields(record[name], value);
            }
            else {
                record[name] = value;
            }
        });
        delete record._replacingHiddenFields;
    }
};
DataForm.prototype.entityPut = function () {
    return _.bind(function (req, res, next) {
        var that = this;
        this.processEntity(req, res, function () {
            if (!req.resource) {
                next();
                return;
            }
            if (!req.body) {
                throw new Error('Nothing submitted.');
            }
            var cleansedBody = that.cleanseRequest(req);
            // Merge
            _.each(cleansedBody, function (value, name) {
                req.doc[name] = (value === '') ? undefined : value;
            });
            if (req.resource.options.hide !== undefined) {
                var hiddenFields = that.generateHiddenFields(req.resource, true);
                hiddenFields._id = false;
                req.resource.model.findById(req.doc._id, hiddenFields, { lean: true }, function (err, data) {
                    that.replaceHiddenFields(req.doc, data);
                    that.saveAndRespond(req, res, hiddenFields);
                });
            }
            else {
                that.saveAndRespond(req, res);
            }
        });
    }, this);
};
DataForm.prototype.entityDelete = function () {
    return _.bind(function (req, res, next) {
        this.processEntity(req, res, function () {
            if (!req.resource) {
                next();
                return;
            }
            req.doc.remove(function (err) {
                if (err) {
                    return res.send({ success: false });
                }
                return res.send({ success: true });
            });
        });
    }, this);
};
DataForm.prototype.entityList = function () {
    return _.bind(function (req, res, next) {
        var that = this;
        this.processEntity(req, res, function () {
            if (!req.resource) {
                return next();
            }
            that.getListFields(req.resource, req.doc, function (err, display) {
                if (err) {
                    return res.status(500).send(err);
                }
                else {
                    return res.send({ list: display });
                }
            });
        });
    }, this);
};
