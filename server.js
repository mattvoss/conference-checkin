/* global require */

/*  ==============================================================
    Include required packages
=============================================================== */

const session = require('express-session');
const cors = require('cors');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const errorhandler = require('errorhandler');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs');
const nconf = require('nconf');
const path = require('path');
const redis = require("redis");
const url = require('url');

const config = require('./config');
let opts = {};
let configFile;
let access_logfile;

/*  ==============================================================
    Configuration
=============================================================== */

//used for session and password hashes
let salt = '20sdkfjk23';

fs.exists(__dirname + '/tmp', (exists) => {
  if (!exists) {
    fs.mkdir(__dirname + '/tmp', (d) => {
      console.log("temp directory created");
    });
  }
});

if (config.log) {
  access_logfile = fs.createWriteStream(config.log, {flags: 'a'});
}

if (config.ssl) {
  if (config.ssl.key) {
    opts.key = fs.readFileSync(config.ssl.key);
  }

  if (config.ssl.cert) {
    opts.cert = fs.readFileSync(config.ssl.cert);
  }

  if (config.ssl.ca) {
    opts.ca = [];
    config.ssl.ca.forEach(function (ca, index, array) {
        opts.ca.push(fs.readFileSync(ca));
    });
  }

  console.log("Express will listen: https");
}

if (config.salt) {
  salt = config.salt;
} else {
  salt = crypto.randomBytes(16).toString('base64');
}

//Session Conf
if (config.redis) {
  redisConfig = config.redis;
}

const redisClient = redis.createClient(
  redisConfig.url+'/'+redisConfig.db,
  {
    retry_strategy: (options) => {
      console.log('redis retry');
      if (options.error && options.error.code === 'ECONNREFUSED') {
        // End reconnecting on a specific error and flush all commands with a individual error
        return new Error('The server refused the connection');
      }
      if (options.total_retry_time > 1000 * 60 * 60) {
        // End reconnecting after a specific timeout and flush all commands with a individual error
        return new Error('Retry time exhausted');
      }
      if (options.attempt > 1000) {
        // End reconnecting with built in error
        return undefined;
      }
      // reconnect after
      return Math.min(options.attempt * 100, 3000);
    }
  }
);
const RedisStore = require('connect-redis')(session);
const allowCrossDomain = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');

  // intercept OPTIONS method
  if ('OPTIONS' === req.method) {
    res.send(200);
  }
  else {
    next();
  }
};
opts.secret = salt;
opts.store = new RedisStore(redisConfig);

const app = module.exports = require("sockpress").init(opts);
const router = app.express.Router();
const apiRouter = app.express.Router();

// Express Configuration
const oneDay = 86400000;
app.use(require('express-domain-middleware'));
app.use(compression());
/**
if ("log" in config) {
  app.use(app.express.logger({stream: access_logfile }));
}
**/
app.use(cookieParser());
app.use(app.express.static(__dirname + '/public'));     // set the static files location
app.use('/css', app.express.static(__dirname + '/public/css'));
app.use('/js', app.express.static(__dirname + '/public/js'));
app.use('/images', app.express.static(__dirname + '/public/images'));
app.use('/img', app.express.static(__dirname + '/public/images'));
app.use('/fonts', app.express.static(__dirname + '/public/fonts'));
app.use('/css/lib/fonts', app.express.static(__dirname + '/public/fonts'));
app.use('/assets', app.express.static(__dirname + '/assets'));
app.use('/lib', app.express.static(__dirname + '/lib'));
app.use('/bower_components', app.express.static(__dirname + '/bower_components'));
app.use(morgan('dev')); // log every request to the console
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));
app.use(bodyParser.json({ type: 'application/vnd.api+json' })); // parse application/vnd.api+json as json
app.use(methodOverride('X-HTTP-Method-Override')); // override with the X-HTTP-Method-Override header in the request
app.use(cors());

const routes = require('./routes');
const ioEvents = require('./ioEvents');

routes.setKey("configs", config);
routes.initialize();
ioEvents.initialize(config);

/*  ==============================================================
    Routes
=============================================================== */

//Standard Routes
router.get('/', routes.index);
app.use('/', router);

// API:Registrants
apiRouter.get('/registrants', routes.registrants);
apiRouter.get('/registrants/:id', routes.getRegistrant);
apiRouter.get('/download/checkedin', routes.downloadCheckedInAttendees);
apiRouter.put('/registrants/:id', routes.updateRegistrantValues);
apiRouter.post('/registrants', routes.addRegistrant);
apiRouter.patch('/registrants/:id', routes.updateRegistrant);
apiRouter.get('/fields/:type', routes.getFields);
apiRouter.get('/exhibitors/companies', routes.getExhibitorCompanies);

// Generate Badge
apiRouter.get('/registrants/:id/badge/:action', routes.genBadge);

// Generate Receipt
apiRouter.get('/registrants/:id/receipt/:action', routes.genReceipt);

//API:Events
apiRouter.get('/events', routes.getEvents);
apiRouter.get('/events/:id/fields', routes.getEventFields);
apiRouter.get('/events/onsite', routes.getOnsiteEvents);

apiRouter.post('/payment', routes.makePayment);
apiRouter.get('/getNumberCheckedIn', routes.getNumberCheckedIn);
apiRouter.get('/company', routes.findCompany);
apiRouter.get('/siteid', routes.findSiteId);
apiRouter.get('/votingSite/:query', routes.findVotingSites);
apiRouter.get('/votingSites', routes.getVotingSites);
apiRouter.get('/votingSiteId', routes.findVotingSiteId);
apiRouter.get('/voter/:voterId', routes.authVoter);
apiRouter.get('/voter/:voterId/pin/:pin', routes.verifyVoterPin);
apiRouter.get('/site/:siteId', routes.verifySiteId);
apiRouter.put('/voter/voter-type/:voterId', routes.addVoterType);
apiRouter.delete('/voter/:voterId', routes.logoutVoter);
apiRouter.post('/castVote', routes.castVotes);
apiRouter.get('/offices', routes.offices);

app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  console.log('error on request %d %s %s', process.domain.id, req.method, req.url);
  console.log(err.stack);
  res.send(500, "Something bad happened. :(");
  if (err.domain) {
    //you should think about gracefully stopping & respawning your server
    //since an unhandled error might put your application into an unknown state
    process.exit(0);
  }
});

/*  ==============================================================
    Socket.IO Routes
=============================================================== */

routes.setKey("io", app.io);
app.io.route('ready', ioEvents.connection);

/*  ==============================================================
    Launch the server
=============================================================== */
const port = (config.port) ? config.port : 3001;
app.listen(port);
