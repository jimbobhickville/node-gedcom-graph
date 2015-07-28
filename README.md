# node-gedcom-graph
Node.js project to parse a gedcom file and generate a graph database with the contents.  Currently targeting neo4j only.

# Usage

This script must be run on the machine that hosts both the neo4j database and the gedcom file you want to import.
It does bulk local import because importing records over the network to neo4j is excruciatingly slow.  The import
time dropped from crashing after 15 minutes to taking around 6 seconds on a rather large gedcom file (~145MB).

## Options:

    -s --src - path to the gedcom file to be parsed (default: read from STDIN)
    -d --dest - path to neo4j's data folder (i.e. /var/lib/neo4j/data/graph.db)
    -b --bindir - path to neo4j's bin folder (i.e. /usr/local/bin)
    -v --verbose - show debug level output
    -t --tmpdir - temporary location for intermediate CSV files (default: /tmp/ged2neo-csvs)
    -q --quiet - suppress all output apart from error messages

Specify everything:

    node index.js -s gedcom.ged -d /path/to/neo4j/data/graph.db -b /path/to/neo4j/bin

Or read the gedcom file from STDIN:

    node index.js -d /path/to/neo4j/data/graph.db -b /path/to/neo4j/bin < gedcom.ged

Use default system paths for neo4j binaries:

    node index.js -s gedcom.ged -d /path/to/neo4j/data/graph.db

Use default system path for neo4j's data folder:

    node index.js -s gedcom.ged -b /path/to/neo4j/bin

# How it works (high level)

1. Reads the gedcom file into a ReadStream
2. Pipes that through gedcom-stream (https://github.com/connrs/gedcom-stream)
3. Pipes that gedcom-stream into a WriteStream that then pipes to multiple fast-csv streams (https://github.com/)
    - one stream per record type (INDI, FAM, etc)
4. Uses neo4j-import to bulk import those generated CSV files into a temporary folder
5. Stops neo4j
6. Backs up the old neo4j database.
7. Moves the temp folder into the neo4j database.
8. Starts neo4j again

If something fails between steps 5 and 8, the backup is moved back into place, so it's as if nothing happened.

# TODO

1. Profile the CVS writer and figure out why it takes the bulk of the time.
2. Add tests
3. Automatically run tests in Travis CI on PR
4. Add indexes to generated nodes
5. Convert dates to more useful format
6. Split name into given/surname
7. Configure logger format to something more useful
8. Redirect output from child_process to logger.

