#!/usr/bin/env node

/*
	Builds static html pages
	- Replaces image references with a CDN link and appends the image hash as a query parameter
	- Finds all local css files and replaces them with a single minified reference
		- Also replacing the link with a CDN link
	- Does the same thing for all referenced js files
	- Outputs minified html
	- Uploads to GCS at the very end

	Outfiles are:
	- [abc].html
	- [abc].[hash].css
	- [abc].[hash].js
	- img/*
*/


var fs = require('fs'),
	cheerio = require('cheerio'),
	htmlminify = require('html-minifier').minify;
	CleanCSS = require('clean-css'),
	UglifyJS = require('uglify-js'),
	crypto = require('crypto'),
	URLRewriter = require("cssurl").URLRewriter,
	child_process = require('child_process');

var BASE_URL = 'https://a.lemm.app/pages/';

var IMG_PREFIX = '/img/'
var IMG_URL = 'https://a.lemm.app/pages/img/'

var CSS_PREFIX = '/css/';

var JS_PREFIX = '/js/';

var cleancss_options = {


};



function hash(str) {
	return crypto.createHash('md5').update(str).digest('hex').slice(0, 20);
}

function changeImageUrl(s) {
	if(s.indexOf(IMG_PREFIX) != 0) {
		return s;
	}

	var filename = s.slice(IMG_PREFIX.length);
	var data = fs.readFileSync(__dirname + '/public/img/' + filename);
	var img_hash = hash(data);

	return IMG_URL + filename + '?h=' + img_hash;
}



console.log('Clean old');
child_process.execSync('rm -r out; mkdir -p out');


var page_names = ['prep', 'partners', 'pricing']

console.log('Load html');
var pages = [];
page_names.map((n) => {
	pages.push(
		cheerio.load(fs.readFileSync(__dirname + '/public/' + n + '.html'))
	);
})


console.log('Read images');
function imgMapper($, i, el) {
	var $el = $(el);

	var src = $el.attr('src');
	if(src) {
		$el.attr('src', changeImageUrl(src));
	}

	var srcset = $el.attr('srcset');
	if(srcset) {
		var parts = srcset.split(/\s+/);
		for(var i = 0; i < parts.length; i += 2) {
			parts[i] = changeImageUrl(parts[i]);
		}

		$el.attr('srcset', parts.join(' '));
	}

	var deferedSrc = $el.attr('data-src');
	if(deferedSrc) {
		$el.attr('data-src', changeImageUrl(deferedSrc));
	}
}

pages.map(($) => {
	$('img').map((i, el) => imgMapper($, i, el));
	$('source').map((i, el) => imgMapper($, i, el));
});

child_process.execSync('cp -r public/img out/')



// TODO: Need to figure out how much of the css is common and how much is not common
console.log('Read css');

var pages_cssrefs = [];

pages.map(($) => {
	var refs = [];
	$('link').map((i, el) => {
		var $el = $(el);
		var href = $el.attr('href');
	
		if(href.indexOf(CSS_PREFIX) != 0) {
			return;
		}
	
		var filename = href.slice(CSS_PREFIX.length);
		refs.push(filename);
	});

	pages_cssrefs.push(refs);

})



// Generate all css stuff

// Determine which css files are common to all
var common_cssrefs = [];
pages_cssrefs.map((refs, i) => {

	for(var j = 0; j < refs.length; j++) {
		var r = refs[j];

		var inall = true;
		for(var k = 0; k < pages_cssrefs.length; k++) {
			if(pages_cssrefs[k].indexOf(refs[j]) < 0) {
				inall = false;
				break;
			}
		}

		if(inall) {
			common_cssrefs.push(r);
			for(var k = 0; k < pages_cssrefs.length; k++) {
				pages_cssrefs[k].splice(pages_cssrefs[k].indexOf(r), 1);
			}

			j--;
		}
		else if(common_cssrefs.indexOf(r) >= 0) {
			refs.splice(j, 1);
			j--;
		}
	}
});

function bundleCss(name, arr) {
	var css_src = '';
	arr.map((filename) => {
		css_src += fs.readFileSync(__dirname + '/public/css/' + filename).toString('utf8') + '\n';
	})

	var rewriter = new URLRewriter(changeImageUrl);
	css_src = rewriter.rewrite(css_src);

	// TODO: Also run through autoprefixer
	css_src = (new CleanCSS(cleancss_options).minify(css_src)).styles;
	var css_file = name + '.' + hash(css_src) + '.css';
	fs.writeFileSync(__dirname + '/out/' + css_file, css_src);

	return BASE_URL + css_file;
}


var common_cssfile = null;
if(common_cssrefs.length > 0) {
	common_cssfile = bundleCss('common', common_cssrefs);
}

var pages_cssfiles = pages_cssrefs.map((refs, i) => {
	var arr = [];

	if(common_cssfile) {
		arr.push(common_cssfile);
	}

	if(refs.length > 0) {
		arr.push(bundleCss(page_names[i], refs));
	}

	return arr;
});


// Generate a common file and a single css per page remaining

// Insert back into each file
pages.map(($, i) => {

	var files = pages_cssfiles[i];
	var filesIdx = 0;

	$('link').map((i, el) => {
		var $el = $(el);
		var href = $el.attr('href');
	
		if(href.indexOf(CSS_PREFIX) != 0) {
			return;
		}
		
		// NOTE: This assumes that there are already enough css link tags in the file to hold all of the new css source files we are referencing
		if(filesIdx >= files.length) {
			$el.remove();
		}
		else {
			$el.attr('href', files[filesIdx++]);
		}
	})
})






// TODO: currently only supports separate js files per page
console.log('Read js');
pages.map(($, i) => {

	var js_first = null;
	var js_src = '';
	$('script').map((i, el) => {
		var $el = $(el);
		var src = $el.attr('src');
	
		if(!src || src.indexOf(JS_PREFIX) != 0) {
			return;
		}
	
		var filename = src.slice(JS_PREFIX.length);
		js_src += fs.readFileSync(__dirname + '/public/js/' + filename).toString('utf8') + '\n';
	
		if(js_first) {
			$el.remove();
		}
		else {
			js_first = $el;
		}
	});
	
	if(js_src.length == 0) {
		return;
	}
	
	var r = UglifyJS.minify({
		"file.js": js_src
	}, {});
	js_src = r.code;
	
	var js_file = 'main.' + hash(js_src) + '.js';
	js_first.attr('src', BASE_URL + js_file);
	fs.writeFileSync(__dirname + '/out/' + js_file, js_src);

});


console.log('Write html');
pages.map(($, i) => {
	var name = page_names[i];

	var html = htmlminify($.html(), {
		keepClosingSlash: true,
		removeComments: true,
		collapseWhitespace: true,
		minifyCSS: true,
		minifyJS: true,
	})
	fs.writeFileSync(__dirname + '/out/' + name + '.html', html);
})


console.log('Copying to gcs')
child_process.execSync('gsutil -m cp -z html,js,css,svg -r out/* gs://lm-assets/pages/')
