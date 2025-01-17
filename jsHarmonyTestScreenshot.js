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

var jsHarmonyTestSpec = require('./jsHarmonyTestScreenshotSpec.js');
var _ = require('lodash');
var ejs = require('ejs');
var fs = require('fs');
var path = require('path');
var async = require('async');
var HelperFS = require('jsharmony/HelperFS');

//  Parameters:
//    jsh: The jsHarmony Server object
//    settings: settings object, e.g. jsHarmonyTestConfig
//    _test_config_path: Path to the test screenshots config folder
//    _test_data_path:   Path to the test screenshots data folder
function jsHarmonyTestScreenshot(_jsh, settings, _test_config_path, _test_data_path) {
  
  this.jsh = _jsh;
  if(_jsh) this.platform = _jsh;
  else{
    this.platform = {
      Config: {
        app_name: '',
        error_email: '',
      },
      SendEmail: function(mparams, cb){ if(cb) cb(); },
    };
  }
  if (!settings) {
    _jsh.Log.warning('jsHarmonyTestScreenshot: No settings provided');
    settings = {};
  }

  var data_folder = 'data';
  var default_test_config_path = path.join('test', 'screenshots');
  var default_test_data_config_path = path.join(data_folder, 'jsharmony-test/screenshots');

  this.browser = null;
  this.test_config_path = path.normalize(((_.isEmpty(_test_config_path)) ? default_test_config_path : _test_config_path));
  this.test_data_path = path.normalize(((_.isEmpty(_test_data_path)) ? default_test_data_config_path : _test_data_path));

  this.master_dir = 'master';
  this.comparison_dir = 'comparison';
  this.diff_dir = 'diff';

  this.show_progress = true;
  this.show_browser = false;

  if (!settings.server) {
    var port = _jsh.Config.server.http_port;
    if(_jsh.Servers['default'] && _jsh.Servers['default'].servers && _jsh.Servers['default'].servers.length) port = _jsh.Servers['default'].servers[0].address().port;

    settings.server = 'http://localhost:' + port;
  }

  this.settings = settings;
}

jsHarmonyTestScreenshot.prototype.screenshotsMasterDir = function() {
  return path.join(this.test_data_path, this.master_dir);
};

jsHarmonyTestScreenshot.prototype.screenshotsComparisonDir = function() {
  return path.join(this.test_data_path, this.comparison_dir);
};

jsHarmonyTestScreenshot.prototype.screenshotsDiffDir = function() {
  return path.join(this.test_data_path, this.diff_dir);
};

jsHarmonyTestScreenshot.prototype.resultFilePath = function() {
  return path.join(this.test_data_path, 'screenshots.result.html');
};

jsHarmonyTestScreenshot.prototype.reviewFilePath = function() {
  return path.join(this.test_data_path, 'screenshots.review.html');
};

jsHarmonyTestScreenshot.prototype.info = function(txt, options) {
  this.jsh.Log.info(txt, options);
};

jsHarmonyTestScreenshot.prototype.warning = function(txt, options) {
  this.jsh.Log.warning(txt, options);
};

jsHarmonyTestScreenshot.prototype.error = function(txt, options) {
  this.jsh.Log.error(txt, options);
};

jsHarmonyTestScreenshot.prototype.reportErrors = function(tests) {
  var rslt = '';
  rslt += reportErrorsIn(tests, 'importWarnings', 'Import Warnings');
  rslt += reportErrorsIn(tests, 'testWarnings', 'Warnings');
  rslt += reportErrorsIn(tests, 'testErrors', 'Errors');
  return rslt;
};

function reportErrorsIn(tests, property, title) {
  var errText = '';
  let count = 0;
  _.forEach(tests, function(testSpec) {
    count = count + testSpec[property].length;
  });
  if (count > 0) {
    errText += '\n' + title + '\n';
    _.forEach(tests, function(testSpec) {
      if (testSpec[property].length > 0) {
        errText += '  ' + testSpec.sourcePath + ':' + testSpec.sourceName + '\n';
        _.forEach(testSpec[property], function(x) {
          errText += '    ' + x + '\n';
        });
      }
    });
  }
  return errText;
}

//Generate the "master" set of screenshots, in the "test_data_path/master" folder
//  Parameters:
//    cb - The callback function to be called on completion
//Delete the contents of the test_data_path/master folder, if it exists.  Do not delete the folder itself.
//Create the test_data_path/master folder tree, if necessary
jsHarmonyTestScreenshot.prototype.generateMaster = async function (cb) {
  if(this.jsh.Extensions.image.type != 'jsharmony-image-magick'){
    var err = new Error('Screenshot tests require jsharmony-image-magick extension');
    this.error(err);
    if (cb) return cb(err);
    else throw err;
  }

  let master_dir = this.screenshotsMasterDir();

  let review_file = this.reviewFilePath();
  if (fs.existsSync(review_file)) fs.unlinkSync(review_file);
  HelperFS.rmdirRecursiveSync(master_dir);
  HelperFS.createFolderRecursiveSync(master_dir);
  let tests = await this.loadTests();
  await this.generateScreenshots(tests, master_dir);

  var errText = this.reportErrors(tests);
  if(errText) this.info(errText);

  let images = this.prepareReview(tests);

  if(!images.length) this.info('No screenshots generated');
  else if(!errText) this.info('Master screenshots generated');

  this.generateReview(images, errText, cb);
};

//Generate the "comparison" set of screenshots, in the "test_data_path/comparison" folder
//  Parameters:
//    cb - The callback function to be called on completion
//Create the test_data_path/comparison folder tree, if necessary
jsHarmonyTestScreenshot.prototype.generateComparison = async function (cb) {
  if(this.jsh.Extensions.image.type != 'jsharmony-image-magick'){
    var err = new Error('Screenshot tests require jsharmony-image-magick extension');
    this.error(err);
    if (cb) return cb(err);
    else throw err;
  }

  let comparison_dir = this.screenshotsComparisonDir();

  HelperFS.rmdirRecursiveSync(comparison_dir);
  HelperFS.createFolderRecursiveSync(comparison_dir);
  let tests = await this.loadTests();
  await this.generateScreenshots(tests, comparison_dir);

  var errText = this.reportErrors(tests);
  if(errText) this.info('Errors occurred running tests\n'+errText);

  if (cb) return cb(new Error(errText));
  if(errText) throw new Error(errText);
};

jsHarmonyTestScreenshot.prototype.getBrowser = async function () {
  var _this = this;
  var jsh = this.jsh;
  var browserParams = { ignoreHTTPSErrors: true, headless: !this.show_browser, ignoreDefaultArgs: [ '--hide-scrollbars' ] };

  try {
    var puppeteer = await new Promise((resolve,reject) => {
      jsh.Extensions.report.getPuppeteer(async function(err, p){
        if(err) return reject(err);
        resolve(p);
      });
    });
    _this.browser = await puppeteer.launch(browserParams);
  } catch (e) {
    _this.error(e);
  }
  return _this.browser;
};

//Run the full "comparison" test
//  Parameters:
//    cb - The callback function to be called on completion
//Delete the "test_data_path/comparison" folder, if it exists before running.  Do not delete the folder itself.
//Delete the "test_data_path/diff" folder, if it exists before running.  Do not delete the folder itself.
//Delete the "test_data_path/screenshot.result.html" file, if it exists before running
jsHarmonyTestScreenshot.prototype.runComparison = async function (cb) {
  if(!cb) cb = function(err){};

  let _this = this;
  let log = _this;

  let path_master = _this.screenshotsMasterDir();
  let master_files = [];
  try {
    master_files = fs.readdirSync(path_master);
  }
  catch(ex){
    if(ex && ex.code=='ENOENT'){ /* Do nothing */ }
    else throw ex;
  }
  if (master_files.length <= 1) {
    var errmsg = 'No master images found. Master images should be generated by running "jsharmony test master screenshots".';
    _this.error(errmsg);
    return cb(errmsg);
  }

  let result_file = _this.resultFilePath();
  if (fs.existsSync(result_file)) fs.unlinkSync(result_file);
  let diff_dir = _this.screenshotsDiffDir();
  HelperFS.rmdirRecursiveSync(diff_dir);
  HelperFS.createFolderRecursiveSync(diff_dir);
  var testError = null;
  try {
    await this.generateComparison();
  }
  catch(ex){
    testError = ex;
  }
  _this.compareImages(function (err, failImages) {
    if (err) {
      _this.error(err);
      return cb(err);
    }
    log.info('# fail: ' + failImages.length);
    if(!failImages.length) _this.info('Screenshot tests completed successfully');
    _this.generateReport(failImages, testError, function() {
      if (failImages.length > 0) return _this.sendErrorEmail(failImages, testError, cb);
      return cb(null, failImages.length);
    });
  });
};

//Read the test_config_path folder, and parse the tests
//  Parameters:
//    cb - The callback function to be called on completion
//Returns an associative array of jsHarmonyTestScreenshotSpec:
//{
//  “SCREENSHOT_NAME”: jsHarmonyTestScreenshotSpec Object
//}
//Set test.id to SCREENSHOT_NAME
//Sort tests by test.batch, then by test.id.  Undefined batch should run last
jsHarmonyTestScreenshot.prototype.loadTests = async function (cb) {
  let _this = this;
  let tests = [];
  // some application modules define moduledir, some don't.
  //  If they don't, we need to scan our local path
  //  If they do, we need to be careful not to load them twice
  let local_path = path.resolve(_this.test_config_path);
  await _this.loadTestsInFolder('', local_path, tests);

  _.forEach(_this.settings.additionalTestSearchPaths, async function(extra) {
    if (extra.path) {
      let fpath = path.resolve(extra.path);
      if (fpath != local_path) {
        await _this.loadTestsInFolder(extra.group, fpath, tests);
      }
    }
  });

  if (tests.length < 1) {
    _this.warning('No tests defined. Place test JSON files in ' + local_path);
  }

  tests.sort(function (a, b) {
    if (a.batch && b.batch) return a.batch - b.batch;
    if (!a.batch && b.batch) return 1;
    if (a.batch && !b.batch) return -1;
    return 0;
  });
  if (cb) cb(null, tests);
  else return tests;
};

jsHarmonyTestScreenshot.prototype.loadTestsInFolder = async function (moduleName, folderPath, tests) {
  let _this = this;
  let testOnly = this.settings.testOnly || [];
  try {
    await new Promise((resolve,reject) => {
      HelperFS.funcRecursive(folderPath, function(fullpath, fname, file_cb){
        if (fname.startsWith('_')) return file_cb();
        if (fname.substring(fname.length-5) !== '.json') return file_cb();
        if (testOnly.length > 0 && testOnly.indexOf(fname) == -1) return file_cb();
        let test_group = getTestsGroupName(moduleName,fname);
        _this.parseTests(fullpath, test_group, tests, file_cb);
      },undefined,undefined,function(err) {
        if (err) return reject(err);
        resolve();
      });
    });
  } catch (e) {
    _this.error(e);
  }
  return tests;
};

//Go through jsh.Modules paths, and for each folder, parse the tests in test_config_path
//Prepend folder path to SCREENSHOT_NAME: screenshots/*FOLDER_PATH*/TEST.json
jsHarmonyTestScreenshot.prototype.includeJsHarmonyModuleTests = async function() {
  var _this = this;
  _.forEach(_this.jsh.Modules, async function(module) {
    if (module.Config.moduledir) {
      let fpath = path.resolve(path.join(module.Config.moduledir, _this.test_config_path));
      _this.settings.additionalTestSearchPaths.push({group: module.name, path: fpath});
    }
  });
};

//Parse a string and return a jsHarmonyTestScreenshotSpec object
//  Parameters:
//    fpath: The full path to the config file
//    test_group: test id prefix
//    file_test_specs: array to append jsHarmonyTestScreenshotSpec objects
//    cb - The callback function to be called on completion
//Use jsh.ParseJSON to convert the string to JSON
jsHarmonyTestScreenshot.prototype.parseTests = function(fpath, test_group, file_test_specs, cb){
  let _this = this;
  let screenshotOnly = this.settings.screenshotOnly || [];
  let warningCount = 0;
  _this.jsh.ParseJSON(fpath, 'jsHarmonyTest', 'Screenshot Test ' + fpath, function(err, file_tests) {
    if (err) return cb(err);
    for (const file_test_id in file_tests) {
      if (screenshotOnly.length > 0 && screenshotOnly.indexOf(file_test_id) == -1) continue;
      const testSpec = jsHarmonyTestSpec.fromJSON(_this, test_group + '_' + sanitizePath(file_test_id), file_tests[file_test_id]);
      testSpec.sourcePath = fpath;
      testSpec.sourceName = file_test_id;
      file_test_specs.push(testSpec);
      warningCount = warningCount + testSpec.importWarnings.length;
    }

    if (warningCount > 0) {
      _this.jsh.Log.warning('Warnings importing ' + fpath);
      _.forEach(file_test_specs, function(testSpec) {
        _.forEach(testSpec.importWarnings, function(x) {_this.jsh.Log.warning(x);});
      });
    }

    cb(null, file_test_specs);
  });
};

function getTestsGroupName(module, file_name) {
  if (file_name.startsWith('_')) {
    return null;
  }
  let name = module + '_' + file_name;
  return sanitizePath(name);
}

function sanitizePath(string) {
  return string.replace(/[^0-9A-Za-z]/g, '_');
}

//Generate screenshots of an array of tests, and save into a target folder
//  Parameters:
//    tests: An associative array of jsHarmonyTestScreenshotSpec objects
//    fpath: The full path to the target folder
//    cb: The callback function to be called on completion
//The fpath should be the same as the SCREENSHOT_NAME
jsHarmonyTestScreenshot.prototype.generateScreenshots = async function (tests, fpath, cb) {
  await this.getBrowser();
  let _this = this;
  await new Promise((resolve,reject) => {
    async.eachLimit(tests, 1,
      async function (screenshot_spec) {
        if (_this.show_progress) _this.info(screenshot_spec.url);
        var fname = screenshot_spec.generateFilename();
        var screenshot_path = path.join(fpath, fname);
        await screenshot_spec.generateScreenshot(_this.browser, _this.jsh, screenshot_path);
      },
      function (err) {
        if (err) {
          _this.error(err);
          reject(err);
        }
        if (_this.browser) _this.browser.close();
        resolve();
      });
  });
  if (cb) return cb();
};


//Generate the "diff" image for any screenshots that are not exactly equal, into the "test_data_path/diff" folder
//  Parameters:
//    cb - The callback function to be called on completion
//  Returns an array of Differences:
//  [
//    {
//      image_file: 'image_name.png', //File name of comparison image
//      diff_type: 'DIFF_TYPE',       //One of: 'MASTER_ONLY', 'COMPARISON_ONLY', 'IMAGE_DIFF'
//       diff_file: 'image_name.png'   //File name of the diff image (should be the same as the comparison image)
//    }
//  ]
//Create the test_data_path/diff folder tree, if necessary
jsHarmonyTestScreenshot.prototype.compareImages = function (cb) {
  let _this = this;
  let log = _this;
  let path_master = _this.screenshotsMasterDir();
  let path_comparison = _this.screenshotsComparisonDir();
  let path_diff = _this.screenshotsDiffDir();
  let failImages = [];
  let files = [];
  let files_comp = [];
  try {
    files = fs.readdirSync(path_master);
    files_comp = fs.readdirSync(path_comparison);
  }
  catch(ex){
    if(ex && ex.code=='ENOENT'){ /* Do nothing */ }
    else throw ex;
  }
  log.info('# of existing images to test ' + files.length);
  if (files.length <= 1) {
    log.error('No master images found. Master images should be generated by running "jsharmony test master screenshots".');
  }
  log.info('# of generated images to test ' + files_comp.length);
  let files_not_in_master = _.difference(files_comp, files);
  if (files_not_in_master.length) {
    files_not_in_master.forEach(function (imageName) {
      failImages.push({image_file: imageName, diff_type: 'COMPARISON_ONLY'});
    });
  }
  log.info('# of master images NOT generated ' + files_not_in_master.length);
  async.eachLimit(files, 2,
    function (imageName, each_cb) {
      if (!fs.existsSync(path.join(path_comparison, imageName))) {
        failImages.push({image_file: imageName, diff_type: 'MASTER_ONLY'});
        return each_cb();
      } else {
        let master = path.join(path_master, imageName);
        let comparison = path.join(path_comparison, imageName);
        let diff = path.join(path_diff, imageName);
    
        return _this.gmCompareImageFilesWrapper(master, comparison, 0)
          .then(function (isEqual) {
            if (!isEqual) {
              failImages.push({image_file: imageName, diff_type: 'IMAGE_DIFF', diff_file: imageName});
              return _this.gmCompareImageFilesWrapper(master, comparison, {file: diff})
                .then(
                  function () {
                    return each_cb();
                  });
            } else {
              return each_cb();
            }
          })
          .catch(function (e) {
            _this.error(e);
            failImages.push({image_file: imageName, diff_type: 'ERROR', error: 'Comparison Error: ' + e.toString()});
            return each_cb();
          });
      }
    }, function(err) {cb(err, failImages);});
};

jsHarmonyTestScreenshot.prototype.gmCompareImageFilesWrapper = function (srcpath, cmppath, options) {
  var jsh = this.jsh;
  return new Promise((resolve, reject) => {
    jsh.Extensions.image.getDriver(function(err, imageMagic){
      if(err) return reject(err);

      //Resized version of cmppath, to be the same size as srcpath
      let srcpath_resize = srcpath + '.resize.png';
      let cmppath_resize = cmppath + '.resize.png';
      //Compare function
      let fcmp = function (path1, path2) {
        imageMagic().compare(path1, path2, options, function (err, isEqual, equality, raw) {
          if (err) return reject(err);
          return resolve(isEqual);
        });
      };
      let getImage = function(path, cb) {
        var img = imageMagic(path);
        img.size(function(err, size) {
          if (err) cb(err);
          else return cb(null, {
            img: img,
            width: size.width,
            height: size.height,
            path: path
          });
        });
      };
      let resizeImage = function(img, sizeout, path, cb) {
        if (img.width == sizeout.width && img.height == sizeout.height) {
          cb(null, img);
        } else {
          img.img.autoOrient();
          img.img.crop(sizeout.width, sizeout.height, 0, 0);
          img.img.extent(sizeout.width, sizeout.height);
          img.img.repage(0, 0, 0, 0);
          img.img.noProfile().write(path, function (err) {
            if (err) jsh.Log.error(err);
            if (err) return cb(err);
            getImage(path, cb);
          });
        }
      };
      //Check for differences without generating a difference image
      if (!options.file) return fcmp(srcpath, cmppath);
      else {
        try {
          getImage(srcpath, function(err, img1) {
            if (err) return reject(err);
            getImage(cmppath, function (err, img2) {
              if (err) return reject(err);
              //If srcpath and cmppath are the same size, generate the difference image
              if ((img1.width == img2.width) && (img1.height == img2.height)) return fcmp(img1.path, img2.path);
              var diffsize = {
                width: Math.max(img1.width, img2.width),
                height: Math.max(img1.height, img2.height),
              };
              resizeImage(img1, diffsize, srcpath_resize, function(err, img1) {
                if (err) return reject(err);
                resizeImage(img2, diffsize, cmppath_resize, function(err, img2) {
                  if (err) return reject(err);
                  //Generate the difference image
                  if ((img1.width == img2.width) && (img1.height == img2.height)) return fcmp(img1.path, img2.path);
                  return reject(new Error('Sizes still not the same after resize'));
                });
              });
            });
          });
        } catch (ex) {
          return reject(ex);
        }
      }
    });
  });
};

jsHarmonyTestScreenshot.prototype.prepareReview = function(tests) {
  return _.map(tests, function(screenshot_spec) {
    var fname = screenshot_spec.generateFilename();
    return {image_file: fname};
  });
};

jsHarmonyTestScreenshot.prototype.renderReport = function (failImages, errText, template) {
  var _this = this;
  var str = ejs.render(
    _this.jsh.getEJS(template),
    {
      errText: (errText || '').toString(),
      screenshots_source_dir: _this.master_dir,
      screenshots_generated_dir: _this.comparison_dir,
      screenshots_diff_dir: _this.diff_dir,
      failImages: failImages,
    },
    {},
  );
  return str;
};

jsHarmonyTestScreenshot.prototype.renderReview = function (images, errText, template) {
  var _this = this;
  var str = ejs.render(
    _this.jsh.getEJS(template),
    {
      screenshots_source_dir: _this.master_dir,
      screenshots_generated_dir: _this.comparison_dir,
      screenshots_diff_dir: _this.diff_dir,
      errText: (errText || '').toString(),
      images: images,
    },
    {},
  );
  return str;
};

//Generate the "test_data_path/screenshot.result.html" report
//  Parameters:
//    diff: Output from compareImages function
//    errText: Errors generated during test
//    cb - The callback function to be called on completion
//Use jsh.getEJS('jsh_test_screenshot_report') to get the report source
jsHarmonyTestScreenshot.prototype.generateReport = function (diff, errText, cb) {
  let _this = this;
  let html = _this.renderReport(diff, errText, 'jsh_test_screenshot_report');
  fs.writeFile(_this.resultFilePath(), html, function (err) {
    if (err) _this.error(err);
    if (err && cb) return cb(err);
    if (cb) return cb();
  });
};

jsHarmonyTestScreenshot.prototype.generateReview = function (images, errText, cb) {
  let _this = this;
  let html = _this.renderReview(images, errText, 'jsh_test_screenshot_review');
  fs.writeFile(_this.reviewFilePath(), html, function (err) {
    if (err) _this.error(err);
    if (err && cb) return cb(err);
    if (cb) return cb();
  });
};

//Generate the "test_data_path/screenshot.result.html" report
//  Parameters:
//    diff: Output from compareImages function
//    errText: Errors generated during test
//    cb - The callback function to be called on completion
//Use jsh.getEJS('jsh_test_screenshot_error_email') to get the email source
//Use jsh.Config.error_email for the target email address
//Implement a similar function to Logger.prototype.sendErrorEmail (jsHarmony)
jsHarmonyTestScreenshot.prototype.sendErrorEmail = function (diff, errText, cb) {
  let _this = this;
  if (!cb) cb = function() {};
  if(!_this.platform.Config.error_email) return cb(null, diff.length);
  if(!_this.platform.SendEmail) return cb(null, diff.length);
  if(_this.isSendingEmail){
    setTimeout(function(){ _this.sendErrorEmail(diff, errText, cb); }, 100);
    return;
  }
  let txt = _this.renderReport(diff, errText, 'jsh_test_screenshot_error_email');
  var subject = 'Screenshot test differences in application: '+(_this.platform.Config.app_name||'');
  var mparams = {
    to: _this.platform.Config.error_email,
    subject: subject,
    text: subject + '\r\n' + txt
  };
  _this.isSendingEmail = true;
  _this.platform.SendEmail(mparams, function(){
    _this.info('Email sent');
    _this.isSendingEmail = false;
    if(cb) cb(null, diff.length);
  });
};

exports = module.exports = jsHarmonyTestScreenshot;