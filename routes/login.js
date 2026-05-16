const express = require('express');
const { google } = require('googleapis');

const router = express.Router();
const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];
const redirectUserParamMap = {
    given_name: 'nombre',
    family_name: 'apellido',
    email: 'correo'
};

function getQueryValue(value) {
    if (Array.isArray(value)) {
        return typeof value[0] === 'string' ? value[0].trim() : '';
    }

    return typeof value === 'string' ? value.trim() : '';
}

function updateStoredRedirectUrl(req) {
    if (!req.query || !Object.prototype.hasOwnProperty.call(req.query, 'url_destino')) {
        return;
    }

    const redirectUrl = getQueryValue(req.query.url_destino);

    if (redirectUrl) {
        req.session.postLoginRedirectUrl = redirectUrl;
        return;
    }

    delete req.session.postLoginRedirectUrl;
}

function getBaseRedirectUrl(req) {
    const queryRedirectUrl = getQueryValue(req.query?.url_destino);

    if (queryRedirectUrl) {
        return queryRedirectUrl;
    }

    if (req.session?.postLoginRedirectUrl) {
        return req.session.postLoginRedirectUrl;
    }

    return req.app.redirectAfterLoginUrl;
}

function buildRedirectUrl(req) {
    const redirectUrl = getBaseRedirectUrl(req);
    const googleUser = req.session?.googleUser;

    if (!googleUser) {
        return redirectUrl;
    }

    try {
        const fallbackOrigin = req.protocol + '://' + req.get('host');
        const targetUrl = new URL(redirectUrl, fallbackOrigin);

        Object.entries(redirectUserParamMap).forEach(([sourceKey, targetKey]) => {
            if (!targetUrl.searchParams.has(targetKey)) {
                targetUrl.searchParams.set(targetKey, googleUser[sourceKey] || '');
            }
        });

        if (/^https?:\/\//i.test(redirectUrl)) {
            return targetUrl.toString();
        }

        return targetUrl.pathname + targetUrl.search + targetUrl.hash;
    }
    catch (err) {
        return redirectUrl;
    }
}

function getConnectionUrl(auth) {
    return auth.generateAuthUrl({
        scope: scopes
    });
}

function renderLogin(res, app) {
    return res.render('login', {
        moduledata: {
            authurl: getConnectionUrl(app.googleauth),
            continueurl: app.redirectAfterLoginUrl,
            googleLoggedIn: false
        }
    });
}

function renderLoggedIn(req, res) {
    return res.render('login', {
        moduledata: {
            authurl: getConnectionUrl(req.app.googleauth),
            continueurl: buildRedirectUrl(req),
            googleLoggedIn: true,
            googleUser: req.session?.googleUser || null
        }
    });
}

router.get(['/'], async function(req, res, next) {
    try {
        updateStoredRedirectUrl(req);

        if (req.query.code !== undefined) {
            const authClient = req.app.createGoogleAuthClient();
            const { tokens } = await authClient.getToken(req.query.code);

            authClient.setCredentials(tokens);

            const oauth2 = google.oauth2({
                version: 'v2',
                auth: authClient
            });
            const { data: userInfo } = await oauth2.userinfo.get();

            req.session.googleLoggedIn = true;
            req.session.googleUser = {
                email: userInfo.email || '',
                fullName: userInfo.name || '',
                given_name: userInfo.given_name || '',
                family_name: userInfo.family_name || ''
            };

            return req.session.save((err) => {
                if (err) {
                    return next(err);
                }

                return res.redirect(buildRedirectUrl(req));
            });
        }

        if (req.session?.googleLoggedIn) {
            return renderLoggedIn(req, res);
        }

        return renderLogin(res, req.app);
    }
    catch (err) {
        return next(err);
    }
});

function logout(req, res, next) {
    if (!req.session) {
        res.clearCookie('connect.sid', { path: '/' });
        return res.redirect('/');
    }

    return req.session.destroy((err) => {
        if (err) {
            return next(err);
        }

        res.clearCookie('connect.sid', { path: '/' });
        return res.redirect('/');
    });
}

router.get('/logout', logout);
router.post('/logout', logout);

module.exports = router;
