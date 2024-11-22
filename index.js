// index.js

//serverless & express stuff
const express = require("express");

const app = express();
const bodyParser = require('body-parser');
const useragent = require('express-useragent');
const { validate, ValidationError, Joi } = require('express-validation');

//sql
const sql = require("./db");
//mailer
const mailer = require("./mailer");
const emailregex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

//logging
const errsole = require('errsole');
const ErrsoleMySQL = require('errsole-mysql');

errsole.initialize({
  storage: new ErrsoleMySQL({
    'host': process.env.LOGS_HOST,
    'port': process.env.LOGS_PORT,
    'user': process.env.LOGS_USER,
    'password': process.env.LOGS_PASSWORD,
    'database': process.env.LOGS_DATABASE
  }),
  enableConsoleOutput: true,
  enableDashboard: false,
  appName: 'clipr-auth',
  serverName: 'clipr-auth'
});


//handle posts
app.use(bodyParser.json());
//get user agent details
app.use(useragent.express());


//token stuff
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
//jwt signing key
const secret = process.env.SECRETKEY;



/*
-----------------------------------------------------------------------
------------------------------ FUNCTIONS ------------------------------
-----------------------------------------------------------------------
*/
async function createDevice(device_id, device_type) {
  return await sql`
    INSERT INTO auth2.devices ${sql({
      device_id: device_id,
      device_type: device_type
    })} ON CONFLICT (device_id) DO NOTHING
  `;
}

/**
 * Creates session object
 * @param {String} userID 
 * @returns session info or false
 */
const generateToken = async (userID, sessionID) => {
  const metadata = await sql`
    SELECT metadata from auth2.users
    WHERE uid = ${userID}
  `;

  //auth token
  const payload = {
    uid: userID,
    sid: sessionID,
    metadata: metadata[0].metadata
  };
  const options = { expiresIn: 300 }; //5 min expiration

  return jwt.sign(payload, secret, options);
}

/**
 * Creates a new session in db
 * @param {String} userID 
 * @param {String} user_agent 
 * @returns session details
 */
async function createSession(userID, user_agent) {
  const sessionID = nanoid();
  const access_token = generateToken(userID, sessionID);
  const currentTime = Date.now();

  // Item to store in the database
  const sessionInfo = {
    sid: sessionID, // Primary Key
    uid: userID,
    last_active: currentTime,
    created_at: currentTime,
    user_agent: user_agent
  };
  // write to sessions table
  await sql`
    INSERT INTO auth2.sessions ${sql(sessionInfo)}
  `;

  return access_token;
}

async function validateToken(req, res, next) {
  if (typeof req.headers.authorization === 'undefined') {
    res.status(403).json({ error: 'Token not found'});
  }

  const bearer = req.headers.authorization.split(' ');
  const bearertoken = bearer[1];

  try {
    const verify = jwt.verify(bearertoken, secret);
    req.token  = bearertoken;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      //verify again, but ignore expiry just to make sure its still valid even though its expired
      try {
        const token = jwt.verify(bearertoken, secret, { ignoreExpiration: true });
        //check that the session exists in db
        const refresh = await verifySession(token.sid);
        if (refresh) {
          //generate refreshed access token
          req.token = generateToken(token.uid, token.sid);
          next();
        }
      } catch (err2) {
        return res.status(401).json({ error: err2.message });
      }
    } 
    return res.status(401).json({ error: err.message });
  }


}

async function createUser(email) {
  return await sql`
    INSERT INTO auth2.users ${sql({
      email: email,
    })} RETURNING uid
  `;
}

/**
 * creates and stores 6 digit OTP in database
 * @param {String} email 
 * @returns {String} otp
 */
async function createOTP(email) {
  //generate 6 digit OTP
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < 6; i++ ) {
      otp += digits[Math.floor(Math.random() * 10)];
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hashedOTP = crypto.pbkdf2Sync(otp, salt, 1000, 64, 'sha512').toString('hex');
  const expires = new Date(Date.now() + 15 * 60000) //otp expires in 15 mins
  await sql`
    INSERT INTO auth2.otp ${sql({
      email: email,
      expires: expires,
      hashed_otp: hashedOTP,
      salt: salt
    })}
    ON CONFLICT (email)
    DO UPDATE SET expires = ${expires}, hashed_otp = ${hashedOTP}, salt = ${salt}
  `;
  return otp;
}



/**
 * Checks OTP validity to see if it matches whats in database and its not yet expired
 * @param {String} email 
 * @param {String} otp 
 * @returns {Boolean} validation result
 */
async function validateOTP(email, otp) {
  let p = new Promise((resolve, reject) => {
    if (email == "client@clipr.app" || email == "stylist@clipr.app") {
      resolve(true);
    } //this is for debugging only
    sql`
      SELECT otp.hashed_otp, otp.salt, otp.expires FROM auth2.otp
      WHERE email = ${email}
    `.then((otprow) => {
      const salt = otprow[0].salt;
      const hashedOTP = crypto.pbkdf2Sync(otp, salt, 1000, 64, 'sha512').toString('hex');
      if (otprow[0].hashed_otp === hashedOTP && Date.now() < new Date(otprow[0].expires).getTime()) {
        resolve(true);
      } else {
        resolve(false);
      }
    }).catch((err) => {
      reject(err);
    });
  });

  return await p;
}

/**
 * Fetches all the current sessions of the inputted userID
 * @param {String} userID 
 * @returns Array of sessionID's
 */
async function getSessions(userID) {
  return await sql`
    SELECT * FROM auth2.sessions
    WHERE uid = ${userID}
  `;
}

/**
 * Verifies that the session token is legitimate and refreshes
 * @param {String} sessionID 
 * @returns updated session or nothing
 */
async function verifySession(sessionID) {
  const session = await sql`
    UPDATE auth2.sessions
    SET last_active = ${Date.now()}
    WHERE sid = ${sessionID}
    RETURNING sid
  `;
  return session.length > 0 ? true : false;
}

/**
 * Invalidates a session
 * @param {String} sessionID 
 * @returns Session Attributes
 */
async function removeSession(sessionID) {
  return await sql`
    DELETE FROM auth2.sessions
    WHERE sid = ${sessionID}
    RETURNING sid
  `;
}


/*
-----------------------------------------------------------------------
------------------------------ ENDPOINTS ------------------------------
-----------------------------------------------------------------------
*/

/**
 * Base Path
 * CHANGEME Remove for prod
 */
app.get("/", (req, res, next) => {
  return res.status(200).json({
    message: "Hello from root!",
  });
});



/**
 * login/signup method for email with otp
 * @param {String} email
 * @param {String} otp
 * @returns session id or error
 */
app.post("/login/email", validate({
  body: Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required()
  })
}), async (req, res, next) => {
  //body validation
  if (typeof(req.body.email) !== 'string' || !emailregex.test(req.body.email)) {
    return res.status(400).send({ error: 'Invalid Email' });
  }
  if (typeof(req.body.otp) !== 'string' || req.body.otp.length !== 6) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  //verify otp
  const valid = await validateOTP(req.body.email, req.body.otp).catch((err) => next(err));
  if (!valid) {
    return res.status(401).json({ error: 'Invalid OTP' });
  }

  //check if user exists
  const user = await sql`
    SELECT uid FROM auth2.users
    WHERE email = ${req.body.email}
  `;
  let uid;
  if (user.length > 1) { //multiple accounts, throw an error
    return res.status(400).json({ error: 'Duplicate email detected' }); 
  } else if (user.length === 1) { //user exists
    uid = user[0].uid;
  } else { //create a new user
    const newUser = await createUser(req.body.email).catch((err)=>next(err));
    uid = newUser[0].uid;
  }

  //create session
  const session = await createSession(uid, req.useragent.source);
  
  return res.status(200).json({ access_token: session });
});

/**
 * sends the user an otp that expires in 15 mins
 * @param {String} email
 * @returns {Response} status message
 */
app.post("/otp", validate({
  body: Joi.object({
    email: Joi.string().email().required()
  })
}), async (req, res, next) => {
  //body validation
  if (typeof(req.body.email) !== 'string' || !emailregex.test(req.body.email)) {
    return res.status(400).json({ error: 'Invalid Email' });
  }

  const email = req.body.email
  let otp;
  let mail;
  try{
    //create and save otp in db
    otp = await createOTP(email);
    //email to user
    mail = await mailer.sendOTPMail(email, otp, req.useragent.source, req.socket.remoteAddress);
  } catch(err) {
    return next(err);
  }
 

  return res.status(200).json({"message": "success"});
});

/**
 * updates a users metadata
 * @param {String} access_token (JWT)
 * @param {Object} metadata
 */
app.post("/metadata", validate({
  body: Joi.object({
    access_token: Joi.string().required(),
    metadata: Joi.object({
      role: Joi.string().required()
    }).required()
  }),
}), async (req, res, next) => {
  //body validation
  /*if (typeof(req.body.access_token !== 'string')) {
    return res.status(400).json({ error: 'Invalid Session Token' });
  }*/

  try {
    if (!req.body.metadata.role) { //required metadata field
      throw Error('Missing required "role" attribute in metadata');
    }
    const verify = jwt.verify(req.body.access_token, secret);
    await sql`
      UPDATE auth2.users
      SET metadata = ${req.body.metadata}
      WHERE uid = ${verify.uid}
    `;

  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

/**
 * validates a token, and refreshes if expired
 * @param {String} access_token (JWT)
 */
app.post("/token/validate", validate({
  body: Joi.object({
    access_token: Joi.string().required()
  })
}), async (req, res, next) => {
  //body validation
  /*if (typeof(req.body.access_token !== 'string')) {
    return res.status(400).json({ error: 'Invalid Session Token' });
  }*/
  //const valid = await verifySession(session);

  try {
    const verify = jwt.verify(req.body.access_token, secret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      //verify again, but ignore expiry just to make sure its still valid even though its expired
      try {
        const token = jwt.verify(req.body.access_token, secret, { ignoreExpiration: true });
        //check that the session exists in db
        const refresh = await verifySession(token.sid);
        if (refresh) {
          //generate refreshed access token
          const newToken = generateToken(token.uid, token.sid);
          return res.status(200).json({ access_token: newToken });
        }
      } catch (err2) {
        return res.status(401).json({ error: err2.message });
      }
    } 
    return res.status(401).json({ error: err.message });
  }

  return res.status(200).json({ valid: true });
});

/**
 * Force refresh a token
 * @param {String} access_token (JWT)
 * @returns {String} access_token or error
 */
app.post("/token/refresh", validate({
  body: Joi.object({
    access_token: Joi.string().required()
  })
}), async (req, res, next) => {
  //const bearer = req.headers.authorization.split(' ');
  //const bearertoken = bearer[1];
  const bearertoken = req.body.access_token;
  
  //validate token
  try{
    const token = jwt.verify(bearertoken, secret, { ignoreExpiration: true });
    const refresh = await verifySession(token.sid);
    if (refresh) {
      const newToken = await generateToken(token.uid, token.sid);
      return res.status(200).json({ access_token: newToken });
    }
    return res.status(401).json({ error: 'Invalid Token' });
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

/**
 * Revokes a session by deleting from db, session will expire after 5 mins
 * @param {String} access_token
 */
app.post("/token/revoke", validate({
  body: Joi.object({
    access_token: Joi.string().required()
  })
}), async (req, res, next) => {
  //body validation
  /*if (typeof(req.body.session !== 'string')) {
    return res.status(400).json({ error: 'Invalid Session Token' });
  }*/
  const bearer = req.headers.authorization.split(' ');
  const bearertoken = bearer[1];
  
  try{
    const token = jwt.verify(bearertoken, secret, { ignoreExpiration: true });
    const removed = await removeSession(token.sid);
    return res.status(200).json({ 'revoked': removed[0].sid });
  } catch (err) {
    next(err.message);
    return;
  }
  
});

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

//error handling
app.use(function (err, req, res, next) {
  if (err instanceof ValidationError) {
    return res.status(err.statusCode).json(err);
  }
  errsole.meta({ reqBody: req.body }).error(err);
  return res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Clipr-Auth started on port ${PORT}`);
});
