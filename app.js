const createError = require('http-errors');
const express = require('express');
const path = require('path');
const fs = require('fs');
const logger = require('morgan');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { serializeError } = require('serialize-error');
const favicon = require('serve-favicon');
const { google } = require('googleapis');

require('log-timestamp')(() => {
    const pad2 = function(num) {
        const str = String(num);
        return (str.length === 1 ? '0' : '') + str;
    };
    const dateTime = new Date();
    const date = dateTime.getDate();
    const hour = dateTime.getHours();
    const mins = dateTime.getMinutes();
    const secs = dateTime.getSeconds();
    const year = dateTime.getFullYear();
    let timezoneOffset = dateTime.getTimezoneOffset();
    const sign = timezoneOffset > 0 ? '-' : '+';
    timezoneOffset = parseInt(Math.abs(timezoneOffset) / 60, 10);
    const month = dateTime.getUTCMonth() + 1;

    return '[' + year + pad2(month) + pad2(date) + '-' + pad2(hour) + pad2(mins) + pad2(secs) + '|UTC' + sign + timezoneOffset + ']';
});

const app = express();
app.redirectAfterLoginUrl = process.env.POST_LOGIN_REDIRECT_URL || 'https://univermilenium.edu.mx/';

app.set('trust proxy', process.env.TRUST_PROXY === 'true' || app.get('env') !== 'development');

function loadRuntimeConfig() {
    let runtimeConfig = {};
    const configPath = path.join(__dirname, 'config', 'config.json');

    if (fs.existsSync(configPath)) {
        try {
            const fileConfig = require(configPath);
            runtimeConfig = fileConfig[process.env.NODE_ENV || 'development'] || fileConfig;
        }
        catch (err) {
            console.error('Error al cargar config/config.json', err.message);
        }
    }

    if (!runtimeConfig.google) {
        runtimeConfig.google = {};
    }
    return runtimeConfig;
}

app.config = loadRuntimeConfig();
app.locals.config = app.config;

const googleConfig = app.config.google || {};
const redirectUri = Array.isArray(googleConfig.redirect_uris) ? googleConfig.redirect_uris[0] : undefined;

app.createGoogleAuthClient = function() {
    return new google.auth.OAuth2(
        googleConfig.client_id,
        googleConfig.client_secret,
        redirectUri
    );
};

app.googleauth = app.createGoogleAuthClient();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.set('etag', false);

app.use(express.static(path.join(__dirname, 'public')));

logger.token('realclfdate', function() {
    const pad2 = function(num) {
        const str = String(num);
        return (str.length === 1 ? '0' : '') + str;
    };
    const dateTime = new Date();
    const date = dateTime.getDate();
    const hour = dateTime.getHours();
    const mins = dateTime.getMinutes();
    const secs = dateTime.getSeconds();
    const year = dateTime.getFullYear();
    let timezoneOffset = dateTime.getTimezoneOffset();
    const sign = timezoneOffset > 0 ? '-' : '+';
    timezoneOffset = parseInt(Math.abs(timezoneOffset) / 60, 10);
    const month = dateTime.getUTCMonth() + 1;

    return year + pad2(month) + pad2(date) + '-' + pad2(hour) + pad2(mins) + pad2(secs) + '|UTC' + sign + timezoneOffset;
});

logger.token('statusColor', function(req, res) {
    const status = (typeof res.headersSent !== 'boolean' ? Boolean(res.header) : res.headersSent) ? res.statusCode : undefined;
    const color = status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : status >= 200 ? 32 : 0;
    return '\x1b[' + color + 'm' + status + '\x1b[0m';
});

logger.token('clientIp', function(req) {
    const realIp = req.headers['x-real-ip'];
    const xff = req.headers['x-forwarded-for'];

    const ipSource =
        realIp ||
        (xff ? xff.split(',')[0] : null) ||
        req.ip ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.connection?.socket?.remoteAddress;

    if (!ipSource) {
        return '-';
    }

    return String(ipSource).trim().replace(/^::ffff:/, '');
});

app.use(logger('\x1b[0m[:realclfdate]\x1b[0m \x1b[33m:method\x1b[0m \x1b[0m:url\x1b[0m :clientIp :statusColor :response-time\0ms'));
app.use(favicon(path.join(__dirname, 'public', 'img', 'favicon', 'favicon.ico')));
const sessionPath = path.join(__dirname, 'sessions');

fs.mkdirSync(sessionPath, { recursive: true });

app.use(session({
    store: new FileStore({
        path: sessionPath
    }),
    secret: process.env.SESSION_SECRET || 'um-google-login-session',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 12 * 60 * 60 * 1000
    }
}));
const loginRouter = require('./routes/login');

app.use('/', loginRouter);

app.use(function(req, res, next) {
    next(createError(404));
});

app.use(function(err, req, res, next) {
    res.status(err.status || 500);

    if (err && ((err.status && err.status === 404) || err.statusCode === 404) && !err.userdetail) {
        err.message = '404 - La pagina no existe.';
        err.userdetail = 'El documento solicitado no fue encontrado en el servidor, favor de revisar su solicitud.';
    }

    console.error(serializeError(err));

    res.render('error', {
        message: err.message || 'Error',
        detail: err.userdetail || (req.app.get('env') !== 'production' ? err.stack : null)
    });
});

if (app.get('env') !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

module.exports = app;
