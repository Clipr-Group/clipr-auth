//serverless & express stuff
const serverless = require("serverless-http");
const express = require("express");
const app = express();
const bodyParser = require('body-parser');
const sql = require("./db");
const emailregex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

//handle posts
app.use(bodyParser.json());

//token stuff
const { SHA256 } = require("crypto-js")
const { v4: uuidv4 } = require('uuid');


/**
 * 
 * @param {String} userId 
 * @returns {String} random id
 */
const generateId = (userId) => {
  const hashInput = `${Date.now()}${userId}${Math.floor(Math.random() * 100000)}`
  const generatedId = SHA256(hashInput, { outputLength: 32 }).toString()
  return generatedId
}

async function createDevice(device_id, device_type) {
  return await sql`
    INSERT INTO devices ${sql({
      device_id: device_id,
      device_type: device_type
    })} ON CONFLICT (device_id) DO NOTHING
  `;
}

/**
 * Creates a new Session
 * @param {String} userID 
 * @returns session info or false
 */
const generateSessionDetails = (userID, device_id) => {
  // Generate Session ID based on User ID
  const sessionID = generateId(userID)
  const currentTime = Date.now()

  // Item to store in the database
  const sessionInfo = {
    sid: sessionID, // Primary Key
    uid: userID,
    last_active: currentTime,
    device_id: device_id
  };

  return sessionInfo;
}

async function createSession(userID, device_id, device_type) {
  //create a device
  const device = await createDevice(device_id, device_type);
  // generate session details
  const sessionDetails = generateSessionDetails(userID, device_id);
  // write to sessions table
  return await sql`
    INSERT INTO sessions ${sql(sessionDetails)}
    RETURNING sid
  `;
}

async function createUser(email) {
  return await sql`
    INSERT INTO users ${sql({
      stylist: false,
      email: email,
    })} RETURNING uid
  `;
}

/**
 * Stores Password reset OTP in database
 * @param {String} email 
 * @param {String} otp 
 * @returns Dyanamo Response
 */
async function storeOTP(email, otp) {
  

}

/**
 * Checks OTP validity to see if it matches whats in database and its not yet expired
 * @param {String} email 
 * @param {String} otp 
 * @returns {Boolean} validation result
 */
async function validateOTP(email, otp) {
  var p = new Promise((resolve, reject) => {
    sql`
      SELECT otp.code, otp.expires FROM users
      JOIN otp on users.uid = otp.uid
      WHERE users.email = ${email}
    `.then((code) => {
      if (code[0].code === otp && Date.now() < new Date(code[0].expires).getTime()) {
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

  
}

/**
 * Verifies that the session token is legitimate and refreshes
 * @param {String} sessionID 
 * @returns updated session or nothing
 */
async function verifyToken(sessionID) {
  
  var currentTime = Date.now()
  //break if no token found
  

  

  //expired token logic
  
      // invalidate session if session is active and it is expired
      
      
      // return update session info
      
    
    
   
  

  //otherwise return session with new expiry date
  const newExpires = currentTime + 1000 * 60 * 60 * 24 * 30 // 30 days from now
  // extend session
  

  // return session info with new expiry date
 
}

/**
 * Invalidates a session
 * @param {String} sessionID 
 * @returns Session Attributes
 */
async function invalidateSession(sessionID) {
  //set active to false
}

/**
 * Base Path
 */
app.get("/", (req, res, next) => {
  return res.status(200).json({
    message: "Hello from root!",
  });
});

/**
 * Registers a new user
 * @param {String} email
 * @returns session id
 */
app.post("/register/email", async (req, res, next) => {
  //body validation
  if (typeof(req.body.email) !== 'string' || !emailregex.test(req.body.email)) {
    return res.status(400).json({ error: 'Invalid Email' });
  }

  var user;
  var session;
  try {
    //create a user
    user = await createUser(req.body.email);
    //create a session
    session = await createSession(user[0].uid, req.body.device_id, req.body.device_type);
  } catch (err) {
    next(err);
    return;
  }
  
  return res.status(200).send(session[0]);
});

/**
 * login method for email with otp
 * @param {String} email
 * @param {String} otp
 * @param {String} device_id
 * @param {String} device_type
 * @returns session id or error
 */
app.post("/login/email", async (req, res, next) => {
  //body validation
  if (typeof(req.body.email) !== 'string' || !emailregex.test(req.body.email)) {
    return res.status(400).json({ error: 'Invalid Email' });
  }
  if (typeof(req.body.otp) !== 'string' || req.body.otp.length !== 6) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  //verify otp
  const valid = await validateOTP(req.body.email, req.body.otp);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid OTP' });
  }

  //check if user exists, and get current session for device
  const user = await sql`
    SELECT * FROM USERS WHERE email = ${req.body.email}
    JOIN sessions on users.uid = sessions.uid
    WHERE email = ${req.body.email}
  `;

  const session = await createSession()

  return res.status(200).send("SUCCESS");
});

/**
 * Sends the user a one time OTP that expires in 10 mins
 */
app.post("/login/otp", async (req, res, next) => {
  const email = req.body.email

  //generate OTP
  var digits = '0123456789';
  let OTP = '';
  for (let i = 0; i < 6; i++ ) {
      OTP += digits[Math.floor(Math.random() * 10)];
  }
  //put in database
  console.log(OTP)
  const stored = await storeOTP(email, OTP)

  //TODO email to user
 

  return res.status(200).send("SUCCESS");
});

/**
 * Debug endpoint for development
 */
app.get("/getToken", (req, res, next) => {
  // SIGNING OPTIONS
  var token = createToken("kooshpatel@gmail.com", 1)
  return res.status(200).send(token);
});

/**
 * Verifies a token is legitimate
 */
app.get("/verify", async (req, res, next) => {
  const sessionID = req.headers.authorization.split(' ')[1]
  const token = await verifyToken(sessionID)
  if (token.isActive) {
    return res.status(200).send({
      isActive: token.isActive,
      expires: token.expires,
    });
  }
  return res.status(403).send("INVALIDTOKEN");
});

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

//error handling
app.use(function (err, req, res, next) {
  console.error(err);
  return res.status(500).send({ error: 'Internal Server Error' });
});

module.exports.handler = serverless(app);
