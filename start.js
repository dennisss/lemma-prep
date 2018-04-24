#!/usr/bin/env node

'use strict';

var express = require('express'),
	path = require('path');

var app = express();

app.use('/', express.static(__dirname + '/public'));

//app.use('/*', (req, res) => {
//	res.redirect('https://www.lem.ma' + req.originalUrl)
//})

app.listen(8001, function() {
	console.log('Running simple Lemma server listening on port 8001!')
});
