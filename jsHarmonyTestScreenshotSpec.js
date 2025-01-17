/*
Copyright 2022 apHarmony

This file is part of jsHarmony.

jsHarmony is free software: you can redistribute it and/or modify
it under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

jsHarmony is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this package.  If not, see <http://www.gnu.org/licenses/>.
*/

var _ = require('lodash');
var async = require('async');

//  Parameters:
//    _test: The parent jsHarmonyTestScreenshot object
//    _id: id of screenshot (eventual base for filename)
function jsHarmonyTestScreenshotSpec(_test,_id){
  this.base_url = _test.settings.server;
  this.id = _id;       //id of screenshot (eventual base for filename)
  this.sourcePath; // path to the file that defined the test
  this.sourceName; // key of the test within the sourcePath
  this.url = ''; //Relative or absolute URL, including querystring
  this.batch = null;
  this.x = 0;
  this.y = 0;
  this.width = 950;
  this.height = 700;
  this.browserWidth = null;
  this.browserHeight = null;
  this.trim = true;
  this.resize = null; //{ width: xxx, height: yyy }
  this.postClip = null; //{ x: 0, y: 0, width: xxx, height: yyy }
  this.cropToSelector = null; //".selector"
  this.onload = function(){}; //function(){ return new Promise(function(resolve){ /* FUNCTION_STRING */ }); }
  this.beforeScreenshot = null; //function(jsh, page, cb){ /* FUNCTION_STRING */ }
  this.waitBeforeScreenshot = 0;
  this.exclude = [
    //Rectangle: { x: ###, y: ###, width: ###, height: ### },
    //Selector: { selector: ".C_ID" }
  ];
  this.importWarnings = [];
  this.testWarnings = [];
  this.testErrors = [];
}

const allowedProperties = {
  'url': '',
  'batch': 0,
  'x': 0,
  'y': 0,
  'width': 950,
  'height': 700,
  'beforeScreenshot': '',  // Server-side JS code
  'onload': '', // In-browser JS code
  'waitBeforeScreenshot': 0,
  'cropToSelector': '', // .C_ID
  'postClip': {},
  'trim': true, // true | false
  'exclude': []
};

const getSelectorRectangle = function (selector) {
  document.querySelector('html').style.overflow = 'hidden';
  if (!selector) return null;
  return new Promise(function (resolve) {
    /* globals jshInstance */
    if (!jshInstance) return resolve();
    var $ = jshInstance.$;
    var jobjs = $(selector);
    if (!jobjs.length) return resolve();
    var startpos = null;
    var endpos = null;
    for (var i = 0; i < jobjs.length; i++) {
      var jobj = $(jobjs[i]);
      var offset = jobj.offset();
      
      var offStart = {left: offset.left - 1, top: offset.top - 1};
      var offEnd = {left: offset.left + 1 + jobj.outerWidth(), top: offset.top + 1 + jobj.outerHeight()};
      
      if (!startpos) startpos = offStart;
      if (offStart.left < startpos.left) startpos.left = offStart.left;
      if (offStart.top < startpos.top) startpos.top = offStart.top;
      
      if (!endpos) endpos = offEnd;
      if (offEnd.left > endpos.left) endpos.left = offEnd.left;
      if (offEnd.top > endpos.top) endpos.top = offEnd.top;
    }
    return resolve({
      x: startpos.left,
      y: startpos.top,
      width: endpos.left - startpos.left,
      height: endpos.top - startpos.top
    });
  });
};

const addElement = function (elem) {
  document.querySelector('html').style.overflow = 'hidden';
  if (!elem) return null;
  if (!jshInstance) return null;
  var $ = jshInstance.$;
  var _elem = $(elem);
  $('html').append(_elem);
};

const excludeElem = async function(exl,page){
  var excludeRectangle = (exl['selector']) ? await page.evaluate(getSelectorRectangle, exl['selector']): exl;
  if(!excludeRectangle) {
    return ['Selector "'+exl['selector']+'" does not exist on the page'];
  }
  let div = generateHoverDiv(excludeRectangle);
  await page.evaluate(addElement, div);
  return [];
};

const sleep = function(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const generateHoverDiv = function(dimensions){
  let d = "<div style='background-color: black; position: absolute; width: {{width}}px; height: {{height}}px; top:{{top}}px; left: {{left}}px;'></div>";
  return d.replace('{{width}}',dimensions.width)
    .replace('{{height}}',dimensions.height)
    .replace('{{top}}',dimensions.y)
    .replace('{{left}}',dimensions.x);
};

//Parse a JSON object and return a jsHarmonyTestScreenshotSpec object
//  Ensure the spec is correct and has no extra fields
//  Parameters:
//    test: The parent jsHarmonyTestScreenshot object
//    id: id of screenshot (eventual base for filename)
//    obj: The JSON object
//Returns a jsHarmonyTestScreenshotSpec object
jsHarmonyTestScreenshotSpec.fromJSON = function(test, id, obj){
  let jsTS = new jsHarmonyTestScreenshotSpec(test, id);
  let warnings = [];
  _.forEach(_.keys(obj), function(key) {
    if (!(key in allowedProperties)) {
      warnings.push('Unknown property [' + key + '] in test ' + id);
    }
  });
  if ('url' in obj) {
    if (obj.url.startsWith(jsTS.base_url)) {
      warnings.push('test urls do not need to include the base url (' + jsTS.base_url + '): ' + id);
    }
  } else {
    warnings.push('No url defined for test ' + id);
  }
  const conf = _.extend({importWarnings: warnings},test.settings.base_screenshot,obj);
  _.assign(jsTS,conf);
  return jsTS;
};

jsHarmonyTestScreenshotSpec.prototype.generateFilename = function(){
  //Generate file name
  var fname = this.id;
  if(this.width) fname += '_' + this.width;
  if(this.height) fname += '_' + this.height;
  fname += '.png';
  return fname;
};

//Generate a screenshot and save to the target file
//  Parameters:
//    browser: A puppeteer Browser object
//    jsh: jsharmony, used for image processing, and beforeScreenshot, which can do... anything
//    fpath: The full path to the destination file
//    cb: The callback function to be called on completion
//If this.test.config.server is undefined, use the following logic to get the server path:
//var port = jsh.Config.server.http_port;
//if(jsh.Servers['default'] && jsh.Servers['default'].servers && jsh.Servers['default'].servers.length) port = jsh.Servers['default'].servers[0].address().port;
jsHarmonyTestScreenshotSpec.prototype.generateScreenshot = async function (browser, jsh, fpath, cb) {
  if (!browser) {
    if (cb) return cb(new Error('no browser available, Please configure jsh.Extensions.report'));
    else return;
  }
  let _this = this;
  if (!this.browserWidth) this.browserWidth = this.x + this.width;
  if (!this.browserHeight) this.browserHeight = this.height;

  let testWarnings = [];
  let testErrors = [];
  let cropRectangle = null;
  try {
    let page = await browser.newPage();
    var fullurl = new URL(_this.url, _this.base_url).toString();
    await page.setViewport({
      width: parseInt(this.browserWidth),
      height: parseInt(this.browserHeight)
    });
    var resp = await page.goto(fullurl);
    var screenshotParams = {path: fpath, type: 'png'};
    // console.log(resp);
    if (resp._status <='304'){
      if (!_.isEmpty(this.onload)){
        var func_onload = parseHandler(jsh, this.onload, [], 'onload', this.sourcePath);
        await page.evaluate(func_onload);
      }
      if (this.cropToSelector){
        cropRectangle = await page.evaluate(getSelectorRectangle, this.cropToSelector);
      }
      if (this.exclude.length){
        let warnings = _.map(this.exclude,async function (exl) {
          return await excludeElem(exl,page);
        });
        testWarnings = testWarnings.concat(warnings);
      }
      if (cropRectangle) this.postClip = cropRectangle;
      if (this.height) {
        screenshotParams.clip = {
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height
        };
      } else screenshotParams.fullPage = true;
      if(this.waitBeforeScreenshot){
        await sleep(this.waitBeforeScreenshot);
      }
      if (!_.isEmpty(this.beforeScreenshot)){
        // beforeScreenshot:function(jsh, page, cb, cropRectangle){
        //     page.click('.xsearch_column').then(cb).catch(function (err) { jsh.Log.error(err); return cb() });
        // }
        // "beforeScreenshot": "function(jsh, page, cb, cropRectangle){return page.click('.xsearchbutton.xsearchbuttonjsHarmonyFactory_QNSSL1');}"
        var func_beforeScreenshot = parseHandler(jsh, this.beforeScreenshot, ['jsh', 'page', 'cb', 'cropRectangle'], 'beforeScreenshot', this.sourcePath);
        await new Promise((resolve) => {
          try{
            func_beforeScreenshot(jsh,page,function(ret) {if (_.isError(ret)) testErrors.push(ret); resolve();}, cropRectangle);
          }catch (e) {
            testErrors.push(e);
            resolve();
          }
        });
      }
    }else{
      screenshotParams.fullPage = true;
    }
    await page.screenshot(screenshotParams);
    await this.processScreenshot(fpath, _this, jsh);
    await page.close();
    this.testWarnings = testWarnings;
    this.testErrors = testErrors;
    if(cb) return cb();
  }catch (e) {
    testErrors.push(e);
    this.testWarnings = testWarnings;
    this.testErrors = testErrors;
    if(cb) return cb(e);
  }
};

function parseHandler(jsh, handler, args, desc, scriptPath) {
  if (_.isArray(handler)) handler = handler.join('');
  return jsh.createFunction(handler, args, desc, scriptPath);
}

jsHarmonyTestScreenshotSpec.prototype.processScreenshot = function (fpath, params, jsh) {
  return new Promise((resolve, reject) => {
    async.waterfall([
      function(img_cb){
        if(!params.postClip && !params.trim) return img_cb();
        var cropParams = [null, null, { resize: false }];
        if(params.postClip){
          cropParams[0] = params.postClip.width;
          cropParams[1] = params.postClip.height;
          cropParams[2].x = params.postClip.x;
          cropParams[2].y = params.postClip.y;
        }
        if(params.trim) cropParams[2].trim = true;
        jsh.Extensions.image.crop(fpath, fpath, cropParams, 'png', img_cb);
      },
      function(img_cb){
        if(!params.resize) return img_cb();
        var resizeParams = [params.resize.width||null, params.resize.height||null];
        jsh.Extensions.image.resize(fpath, fpath, resizeParams, 'png', img_cb);
      },
    ], function(err){
      if (err) reject(err);
      else resolve();
    });
  });
};

module.exports = exports = jsHarmonyTestScreenshotSpec;