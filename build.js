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
	- index.html
	- index.[hash].css
	- index.[hash].js
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

var BASE_URL = 'https://storage.googleapis.com/lm-assets/prep/';

var IMG_PREFIX = '/prep/img/'
var IMG_URL = 'https://storage.googleapis.com/lm-assets/prep/img/'

var CSS_PREFIX = '/prep/css/';

var JS_PREFIX = '/prep/js/';

var cleancss_options = {


};



function hash(str) {
	return crypto.createHash('md5').update(str).digest('hex').slice(0, 20);
}

console.log('Clean old');
child_process.execSync('rm -r out; mkdir -p out');

console.log('Load html');
var $ = cheerio.load(fs.readFileSync(__dirname + '/public/index.html'));

console.log('Read images');
function changeImageUrl(s) {
	if(s.indexOf(IMG_PREFIX) != 0) {
		return s;
	}

	var filename = s.slice(IMG_PREFIX.length);
	var data = fs.readFileSync(__dirname + '/public/img/' + filename);
	var img_hash = hash(data);

	return IMG_URL + filename + '?h=' + img_hash;
}

$('img, source').map((i, el) => {
	var $el = $(el);

	var src = $el.attr('src');
	$el.attr('src', changeImageUrl(src));

	var srcset = $el.attr('srcset');
	if(srcset) {
		var parts = srcset.split(/\s+/);
		for(var i = 0; i < parts.length; i += 2) {
			parts[i] = changeImageUrl(parts[i]);
		}

		$el.attr('srcset', parts.join(' '));
	}
})
child_process.execSync('cp -r public/img out/')


console.log('Read css');
var css_first = null;
var css_src = '';
$('link').map((i, el) => {
	var $el = $(el);
	var href = $el.attr('href');

	if(href.indexOf(CSS_PREFIX) != 0) {
		return;
	}

	var filename = href.slice(CSS_PREFIX.length);
	css_src += fs.readFileSync(__dirname + '/public/css/' + filename).toString('utf8') + '\n';

	if(css_first) {
		$el.remove();
	}
	else {
		css_first = $el;
	}
})



var rewriter = new URLRewriter(changeImageUrl);
css_src = rewriter.rewrite(css_src);

// TODO: Also run through autoprefixer
css_src = (new CleanCSS(cleancss_options).minify(css_src)).styles;
var css_file = 'index.' + hash(css_src) + '.css';
css_first.attr('href', BASE_URL + css_file);
fs.writeFileSync(__dirname + '/out/' + css_file, css_src);






console.log('Read js');
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


var r = UglifyJS.minify({
    "file.js": js_src
}, {});
js_src = r.code;

var js_file = 'index.' + hash(js_src) + '.js';
js_first.attr('src', BASE_URL + js_file);
fs.writeFileSync(__dirname + '/out/' + js_file, js_src);

console.log('Write html');
// TODO: minify html
var html = htmlminify($.html(), {
	keepClosingSlash: true,
	removeComments: true,
	collapseWhitespace: true,
	minifyCSS: true,
	minifyJS: true,
})
fs.writeFileSync(__dirname + '/out/index.html', html);

console.log('Copying to gcs')
child_process.execSync('gsutil -m cp -z html,js,css -r out/* gs://lm-assets/prep/')
