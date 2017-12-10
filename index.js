var path = require('path');
var os = require('os');

var fs = require('fs-extra');
var GedcomStream = require('gedcom-stream');
var log4js = require('log4js');

var Timer = require('./lib/timer');
var Neo4J = require('./lib/neo4j');
var CsvWriter = require('./lib/csv_writer');
var LogStreamer = require('./lib/log_streamer');

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


log4js.configure({
  appenders: {
    access: { type: 'dateFile', filename: 'log/access.log', pattern: '-yyyy-MM-dd' },
    app: { type: 'file', filename: 'log/app.log', maxLogSize: 10485760, numBackups: 3 },
    errorFile: { type: 'file', filename: 'log/errors.log' },
    errors: { type: 'logLevelFilter', level: 'error', appender: 'errorFile' }
  },
  categories: {
    default: { appenders: ['app', 'errors'], level: 'info' },
    http: { appenders: ['access'], level: 'info' }
  }
});
var logger = log4js.getLogger();
if (opts.quiet) {
    logger.level = 'debug';
}
else if (! opts.verbose) {
    logger.level = 'debug';
}

var debug_streamer = new LogStreamer(logger.debug.bind(logger));
var warn_streamer = new LogStreamer(logger.warn.bind(logger));

var timer = new Timer();
var neo4j = new Neo4J(opts.bindir, opts.dest);
var csvs = new CsvWriter(opts.tmpdir);
var gedcom = new GedcomStream();

gedcom.on('error', logger.error.bind(logger));
gedcom.on('end', function () {
    logger.info('Finished parsing gedcom file. Time elapsed:', timer.snap());
    csvs.end();
});
gedcom.pipe(csvs);


var import_args = [];
csvs.on('generate', function (type, path) {
    logger.debug('Generating temporary csv file:', path);
    import_args.push('--' + type, path);
});
csvs.on('skip', function (record) {
    logger.warn('Skipping', record);
});
csvs.on('missing', function (type, missing) {
    logger.warn('Missing', type, missing);
});
csvs.on('finish', function () {
    logger.info('Finished writing intermediate csv files. Time elapsed:', timer.snap());
    neo4j.import(import_args);
});


neo4j.on('manage', logger.debug.bind(logger));
neo4j.on('start', function (path, args) {
    logger.info('Beginning import process:', path);
    logger.debug('With args:', args);
});
neo4j.on('swapping', function (src, dest) {
    logger.debug('Moving folder:', src, '->', dest);
});
neo4j.on('finish', function (path, args) {
    logger.info('Finished importing and restarting neo4j. Time elapsed:', timer.snap());
    csvs.cleanup();
});
neo4j.on('stdout', function (stdout) {
    stdout.pipe(debug_streamer);
});
neo4j.on('stderr', function (stderr) {
    stderr.pipe(warn_streamer);
});


if (opts.src) {
    var gedcom_path = fs.realpathSync(opts.src);
    logger.info('Reading from', gedcom_path);
    fs.createReadStream(gedcom_path).pipe(gedcom);
}
else {
    logger.info('Reading from STDIN');
    process.stdin.pipe(gedcom);
}
