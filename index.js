var path = require('path');
var os = require('os');

var fs = require('fs-extra');
var GedcomStream = require('gedcom-stream');

var Timer = require('./lib/timer');
var Neo4J = require('./lib/neo4j');
var CsvWriter = require('./lib/csv_writer');

var opts = require('nomnom')
    .option('src', {
        abbr: 's',
        help: 'Path to the gedcom file you want to parse'
    })
    .option('dest', {
        abbr: 'd',
        required: true,
        help: 'Path to the neo4j data folder you wish to replace'
    })
    .option('bindir', {
        abbr: 'b',
        default: '/usr/bin',
        help: 'Path to the location of the neo4j binaries'
    })
    .option('tmpdir', {
        abbr: 't',
        default: path.join(os.tmpdir(), 'ged2neo-csvs'),
        help: 'Folder for the temporary CSV files'
    })
    .option('quiet', {
        abbr: 'q',
        flag: true,
        default: false,
        help: 'Suppress output other than errors'
    })
    .option('verbose', {
        abbr: 'v',
        flag: true,
        default: false,
        help: 'Include debug output'
    })
    .parse();

var timer = new Timer();
var neo4j = new Neo4J(opts.bindir, opts.dest);
var csvs = new CsvWriter(opts.tmpdir);
var gedcom = new GedcomStream();

neo4j.on('manage', console.log);
neo4j.on('start', function (path, args) {
    console.log('Beginning import process:', path, args);
});
neo4j.on('swapping', function (src, dest) {
    console.log('Moving folder:', src, '->', dest);
});
neo4j.on('finish', function (path, args) {
    timer.log();
    csvs.cleanup();
});

var import_args = [];
csvs.on('skip', function (record) {
    console.log('Skipping', record);
});
csvs.on('generate', function (type, path) {
    console.log('Generating temporary csv file:', path);
    import_args.push('--' + type, path);
});
csvs.on('missing', function (type, missing) {
    console.log('Missing', type, missing);
});
csvs.on('finish', function () {
    timer.log();
    neo4j.import(import_args);
});

gedcom.on('error', console.log);
gedcom.on('end', function () {
    timer.log();
    csvs.end();
});
gedcom.pipe(csvs);

if (opts.src) {
    var gedcom_path = fs.realpathSync(opts.src);
    console.log('Reading from', gedcom_path);
    fs.createReadStream(gedcom_path).pipe(gedcom);
}
else {
    console.log('Reading from STDIN');
    process.stdin.pipe(gedcom);
}
