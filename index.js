var os = require('os');
var path = require('path');

var csv = require('fast-csv');
var fs = require('fs-extra');
var GedcomStream = require('gedcom-stream');
var moment = require('moment');

var Timer = require('./lib/timer');
var Neo4J = require('./lib/neo4j');
var CsvWriter = require('./lib/csv_writer');


/* TODO:
- figure out if neo4j has any special date types that we could leverage
- better code organization, more custom tag parsers
    - NAME should split into given and surname probably
- figure out neo4j indexes to speed up lookups
- profile for obvious speed issues
- logging?
*/

var opts = require('nomnom')
    .option('input', {
        abbr: 'i',
        help: 'Path to the gedcom file you want to parse'
    })
    .option('destination', {
        abbr: 'o',
        required: true,
        help: 'Path to the neo4j data folder you wish to replace'
    })
    .option('bindir', {
        abbr: 'b',
        default: '/usr/bin',
        help: 'Path to the location of the neo4j binaries'
    })
    .parse();

var timer = new Timer();
var neo4j = new Neo4J(opts.bindir);
var csvs = new CsvWriter();
var gedcom = new GedcomStream();


/* realpathSync requires files to already exist, how do I just expand the path? */
var db_paths = {
    'backup': path.normalize(opts.destination + '.bak'),
    'temp': path.normalize(opts.destination + '.tmp'),
    'real': path.normalize(opts.destination),
};

function swap_dirs(callback) {
    console.log('Swapping temp destination for real one:', db_paths);
    fs.remove(db_paths['backup'], function (error) {
        fs.rename(db_paths['real'], db_paths['backup'], function (error) {
            if (error) { throw error; }
            fs.rename(db_paths['temp'], db_paths['real'], function (error) {
                if (error) { throw error; }
                if (callback) {
                    callback();
                }
            })
        })
    });

}


neo4j.on('manage', console.log);
neo4j.on('startEnd', function (code) {
    if (code != 0) {
        throw 'Starting neo4j failed.  Abort.';
    }
    timer.log();
    csvs.cleanup();
});
neo4j.on('stopEnd', function (code) {
    swap_dirs(function () {
        neo4j.start();
    });
});
neo4j.on('importBegin', function (path, args) {
    console.log('Beginning import process:', path, args);
});
neo4j.on('importEnd', function (path, args, code) {
    if (code === 0) {
        neo4j.stop();
    }
    else {
        throw 'Import failed. Exited ' + code + '. Abort.';
    }
});

csvs.on('skip', function (record) {
    console.log('Skipping', record);
});
var import_args = ['--into', db_paths['temp']];
csvs.on('generate', function (type, path) {
    console.log('Generating temporary csv file:', path);
    import_args.push('--' + type, path);
});
csvs.on('missing', function (type, missing) {
    console.log('Missing', type, missing);
});
csvs.on('finish', function () {
    fs.remove(db_paths['temp'], function (error) {
        fs.mkdir(db_paths['temp'], function (error) {
            if (error) { throw error; }
            timer.log();
            neo4j.import(import_args);
        })
    });
});

gedcom.on('error', console.log);
gedcom.on('end', function () {
    timer.log();
    csvs.end();
});
gedcom.pipe(csvs);

if (opts.input) {
    var gedcom_path = fs.realpathSync(opts.input);
    console.log('Reading from', gedcom_path);
    fs.createReadStream(gedcom_path).pipe(gedcom);
}
else {
    console.log('Reading from STDIN');
    process.stdin.pipe(gedcom);
}
