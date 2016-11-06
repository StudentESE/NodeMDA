/*
Copyright (C) 2016 by Joel Kozikowski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
 */

"use strict";

const NodeMDA = require('../nodemda-core.js');
const MetaModel = require('../meta/meta-model.js');
require('../meta/meta-validator.js');

const fs = require('fs');
const fsx = require('fs-extra');
const path = require('path');
const Handlebars = require('handlebars');
const glob = require('glob');
const winston = require('winston');


(function(mda){

	var getFileList = function (baseDir, stereotype, ext) {
		let dirPath = baseDir;
		if (stereotype !== null) {
			if (typeof(stereotype) === "object") {
				dirPath += '/' + stereotype.getName();
			}
			else {
		       dirPath += '/' + stereotype;
			}
		}

		// Check to see if we have an alias file...
		let aliasFileName = dirPath + '/alias.json';
		if (fsx.existsSync(aliasFileName)) {
			aliasPath = fsx.readJsonSync(aliasFileName);
			dirPath = NodeMDA.getPlatformDir() + '/' + aliasPath;
			winston.debug(`Using alias directory ${dirPath} for stereotype ${stereotype}`);
		}

        let pattern = dirPath + '/*' + ext;

		var files = glob.sync(pattern);
		return files;
	};

	
	var getTemplateList = function (stereotype) {
		return getFileList(mda.getPlatformDir(), stereotype, ".hbs");
	};

	
	var getScriptList = function (stereotype) {
		return getFileList(mda.getPlatformDir(), stereotype, ".js");
	};
	
	
	var getDefaultExtension = function(prototypeFileName) {

		var firstDot = prototypeFileName.indexOf(".", 2);
		var lastDot = prototypeFileName.lastIndexOf(".");

		if (lastDot > firstDot) {
			return prototypeFileName.slice(firstDot, lastDot);
		}
		else {
			return "";
		}
	};

	/**
	 * Checks each parent directory of the specified file name (if any) and
	 * makes sure they exist.
	 */
	var checkDirectories = function(fileName) {
		
	    var path = fileName.split("/");
	    if (path.length >= 2) {
	    	// Check all but the last path component to make sure that it exists...
	    	var currentPath = "";
	    	var startNdx = 0;
	    	if (path[0].length > 0) {
	    		// The "root" was not specified as the first parameter
	    		if (path[0].startsWith(".")) {
	    			currentPath = path[0];
	    			startNdx = 1;
	    		}
	    		else {
	    			currentPath = ".";
	    		}
	    	}
	    	else {
	    		startNdx = 1;
	    	}
	    	
	    	for (var i = startNdx; i < path.length-1; i++) {
	    	   currentPath = currentPath + "/" + path[i];
	    	   if (!fs.existsSync(currentPath)) {
	    		   fs.mkdirSync(currentPath);
	    	   }
	    	} // for
	    }
	};
	
	
	var aggFileList = [];
	
	var getAggregateFd = function(outputFileName) {

		// See if we have a file already open...
		for (var a = 0; a < aggFileList.length; a++) {
		   if (aggFileList[a].fileName === outputFileName) {
			   return aggFileList[a].fd;
		   }	
		} // for
		
		// If we get here, no file is open yet...
		var fd = fs.openSync(outputFileName, "w");
		aggFileList.push({ "fileName" : outputFileName, "fd" : fd});
		
		return fd;
	};
	
	
	var writeToAggregateFile = function(outputFileName, result) {

		var fd = getAggregateFd(outputFileName);
		fs.writeSync(fd, result);
		
	};

	
	var closeAllAggregateFiles = function() {

		for (var a = 0; a < aggFileList.length; a++) {
			fs.closeSync(aggFileList[a].fd);
		} // for
		
		aggFileList = [];
	};
	
	
	var fileNameToProperty = function(fileName) {
		var propName = fileName;
		var lastSlash = fileName.lastIndexOf('/');
		if (lastSlash >= 0) {
			propName = fileName.slice(lastSlash+1, -1);
		}
		
		var lastDot = propName.indexOf(".");
		if (lastDot > 0) {
			propName = propName.slice(0, lastDot);
		}
		
		return propName;
	};
	
	
	var processTemplateFile = function(metaClass, templateFile, context) {
    	var templateData = fs.readFileSync(templateFile, "utf8");

    	context["class"] = metaClass ;
    	context.output = mda.Options.output;
    	
    	var render = Handlebars.compile(templateData);
    	var result = render(context);
    	
    	winston.debug("Processing " + (metaClass !== null ? metaClass.getName() : "project") + " with template " + templateFile);

    	var outputFileName = "";
    	var outputMode = "overwrite";
    	if (result.startsWith("##output ")) {
    		var lineBreak = result.indexOf("\n");
    		var outputDirective = result.slice(0, lineBreak).trim();
    		result = result.slice(lineBreak+1, -1);
    		var params = outputDirective.split(" ");
    		if (params.length === 2) {
    			outputMode= params[1];
    		}
    		else {
    		   outputMode = params[1];
    		   outputFileName = params[2];
    		}
    	}
    	
    	if (outputFileName.length === 0) {
    		// No output directive specified.  Create a default output file name...
    		if (metaClass !== null) {
    			var packageDirName = metaClass.packageDirName;
    			if (packageDirName.length > 0) {
    				packageDirName += "/";
    			}
    		    outputFileName = mda.Options.output + "/" + packageDirName + metaClass.getName() + getDefaultExtension(templateFile);
    		}
    		else {
    			// Default for project files...
    			var parts = path.parse(templateFile);
    			outputFileName = mda.Options.output + "/" + parts.name;
    		}
    	}
    	
    	winston.info("Generating code with output mode " + outputMode + " to " + outputFileName);
    	if (outputMode.toLowerCase() === "overwrite") {
        	checkDirectories(outputFileName);
        	fs.writeFileSync(outputFileName, result);
    	}
    	else if (outputMode.toLowerCase() === "preserve") {
    	   if (!fs.existsSync(outputFileName)) {
    		   checkDirectories(outputFileName);
    		   fs.writeFileSync(outputFileName, result);
    	   }
    	}
    	else if (outputMode.toLowerCase() === "aggregate") {
        	checkDirectories(outputFileName);
    		writeToAggregateFile(outputFileName, result);
    	}
    	else if (outputMode.toLowerCase() === "property") {
    		var propName = fileNameToProperty(outputFileName);
    	    if (!context.hasOwnProperty(propName)) {
    	    	context[propName] = [];
    	    }
    	    
    	    context[propName].push(result);
    	}
    	else if (outputMode.toLowerCase() === "ignore") {
    		// Do nothing...
    		winston.info("   >>> Nothing saved to file.");
     	}
    	else {
    		throw new Error("Unknown output directive '" + outputMode + "' in template " + templateFile);
    	}
    	
	};
	
	
	var processTemplateFileList = function(metaClass, templates, context) {
	    templates.forEach(function(templateFile) {
	    	processTemplateFile(metaClass, templateFile, context);
	    });
	};

	
	
	var execOnce = function(script, initType, typeName, typeValue, context) {

		if (typeof(script.execCache) === "undefined") {
			script.execCache = {};
		}

		var typeCache = script.execCache[initType];
		if (typeCache === undefined) {
			typeCache = {};
			script.execCache[initType] = typeCache;
		}
		
		var execFlag = typeCache[typeName];
		if (execFlag !== true) {
			// We have never executed this combination yet...
			typeCache[typeName] = true;
			var funcName = "init" + initType;
			var fn = script[funcName];
			if (typeof(fn) === "function") {
				var params = [];
				if (context !== null) {
					params.push(context);
				}
				params.push(typeValue);
				fn.apply(script, params);
			}
		} 
		
	};
	
	
	var loadPartials = function(baseDir) {
		winston.debug("Loading partials from directory " + baseDir);
		var templateList = getFileList(baseDir, "_partials", "*.hbs");
		templateList.forEach(function(templateFile) {
			var parts = path.parse(templateFile);
			var partialName = parts.name;
			var templateData = fs.readFileSync(templateFile, "utf8");			
			var partial = Handlebars.compile(templateData);
			Handlebars.registerPartial(partialName, partial);
		});
	};

	
	var fixFileName = function(fileName) {
		if (fileName.startsWith(".")) {
			// Relative file names need to be adjusted to absolute file names...
			fileName = process.cwd() + "/" + fileName;
		}
		return fileName;
	};

	
	/**
	 * Supplements the "require()" module loader to fix up relative paths in scripts
	 * loaded at runtime.
	 */
	var requireScript = function(fileName) {
		return require(fixFileName(fileName));
	};
	
	var loadHelpers = function(baseDir) {
		winston.debug("Loading helpers from directory " + baseDir);
		var helperList = getFileList(baseDir, "_helpers", "*.js");
		helperList.forEach(function(helperFile) {
			var parts = path.parse(helperFile);
			var helperName = parts.name;
			var fn = requireScript(helperFile);			
			Handlebars.registerHelper(helperName, fn);
		});
	};
	
	
	mda.gen = function(modelFileName) {
		
		winston.info("Starting code generation.");
		NodeMDA.runtime = {};
		
		var metaModel = MetaModel.Reader.getMeta(modelFileName);
		
		NodeMDA.runtime.model = metaModel;

		if (!mda.Meta.validate(metaModel)) {
			// We failed validation, just just stop processing.
			return;
		}
		
		var context = { model: metaModel, options: NodeMDA.Options };
		
		// Auto-load any Handlebar partials...
		winston.debug("Loading global helpers...");
		loadHelpers(NodeMDA.getNodeMDADir() + "/global/plugins");
		
		winston.debug("Loading global partials...");
		loadPartials(NodeMDA.getNodeMDADir() + "/global/plugins");

		winston.info("Loading platform support scripts from " + NodeMDA.getPlatformDir() + "...");
		var scriptCount = 0;
		var projectScripts = getScriptList(null);
		projectScripts.forEach(function(s) {
		    scriptCount++;
			var script = requireScript(s);
			if (typeof(script.initPlatform) === "function") {
			    script.initPlatform(context);
			}
		});
		
		winston.debug("Loading helpers for platform " + mda.Options.platform + "...");
		loadHelpers(mda.getPlatformDir());
		
		winston.debug("Loading partials for platform " + mda.Options.platform + "...");
		loadPartials(mda.getPlatformDir());
		
		
		// Process each class...
		metaModel.classes.forEach(function(metaClass) {
			metaClass.stereotypes.forEach(function(stereotype) {
				
				// Process any project scripts...
				projectScripts.forEach(function(ps) {
					var script = requireScript(ps);
					execOnce(script, "Stereotype", stereotype.getName(), stereotype, context);
					execOnce(script, "Class", metaClass.getName(), metaClass, context);
				});
				
				
				// Process any stereotype specific scripts...
				var scripts = getScriptList(stereotype);
				scripts.forEach(function(s) {
					var script = requireScript(s);
				    scriptCount++;
					execOnce(script, "Stereotype", stereotype.getName(), stereotype, context);
					execOnce(script, "Class", metaClass.getName(), metaClass, context);
				});
				
				// Generate the templates...
			    var templates = getTemplateList(stereotype);
			    if (templates.length > 0) {
			    	scriptCount++;
			    }
			    processTemplateFileList(metaClass, templates, context);
			});
		});

		
		// Process any project template scripts...
		projectScripts.forEach(function(s) {
			var script = requireScript(s);
			if (typeof(script.initProjectTemplates) === "function") {
			    script.initProjectTemplates(context);
			}
		});

		
		// Finally, do the project templates...
	    var templates = getTemplateList(null);
	    processTemplateFileList(null, templates, context);
		
		
		closeAllAggregateFiles();
		
		if (scriptCount === 0) {
			winston.error("No script or template files located. Check platform spelling.");
		}
		else {
		    winston.info("Done.");
	    }
		
	};
	
})(NodeMDA);	
