//serverless & express stuff
const serverless = require("serverless-http");
const express = require("express");
const app = express();
const bodyParser = require('body-parser');

//handle posts
app.use(bodyParser.json());

//token stuff
const { SHA256 } = require("crypto-js")
const { v4: uuidv4 } = require('uuid');

//DyanmoDB stuff
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const REGION = process.env.AWS_REGION;
const users_table = "clipr-auth-users";
const session_table = "clipr-auth-sessions";
const dynamo = new DynamoDB({ region: REGION })

//helper function to generate UUID's for users
const generateId = (userId) => {
  const hashInput = `${Date.now()}${userId}${Math.floor(Math.random() * 100000)}`
  const generatedId = SHA256(hashInput, { outputLength: 32 }).toString()
  return generatedId
}

/**
 * Creates a new Session
 * @param {String} userID 
 * @returns session info or false
 */
async function createSession(userID) {
  // Generate Session ID based on User ID
  const sessionID = generateId(userID)
  const currentTime = Date.now()

  // Item to store in the database
  const sessionInfo = {
    sessionID: sessionID, // Primary Key
    userID: userID,
    sessionStartTimestamp: currentTime, // Time the sesion was created
    isActive: true, // Whether the session is Active
    expires: currentTime + 1000 * 60 * 60 * 24 * 30, // Set expiry date of session to 30 days from now
  }

  //wait for dynamo to store and return the result
  var p = new Promise((resolve, reject) => {
    dynamo.putItem({
      TableName: session_table,
      Item: marshall(sessionInfo), // The Item we want to add
    }, function(err) {
      if (err) {
        resolve(false)
      } else {
        resolve(sessionInfo)
      }
    })
  })
  
  return await p;
}

/**
 * Creates a new user
 * @param {String} email 
 * @param {String} hash //password hash 
 * @param {String} userID 
 * @returns BOOL indicating whether user was created or not
 */
async function createUser(email, hash, userID) {
  const user = {
    userID: userID,
    email: email,
    passhash: hash
  }

  var p = new Promise((resolve, reject) => {
    dynamo.putItem({
      TableName: users_table,
      Item: marshall(user),
      ConditionExpression: 'attribute_not_exists(email) AND attribute_not_exists(userID)'
    }, function(err) {
      if (err) {
        console.log('CREATE USER ERROR:');
        console.log(err);
        resolve(false)
      } else {
        resolve(true)
      }
    });
  });
  
  return await p;
}

/**
 * Updates the users password
 * @param {String} userID 
 * @param {String} hash //new password hash
 * @returns dynamo response
 */
async function updatePassword(userID, hash) {

  const key = marshall({ userID: userID })

  return await dynamo.updateItem({
    TableName: users_table,
    Key: key,
    UpdateExpression: "SET passhash = :h",
    ExpressionAttributeValues: marshall({
      ":h": hash,
    }),
  });
}

/**
 * Stores Password reset OTP in database
 * @param {String} email 
 * @param {String} otp 
 * @returns Dyanamo Response
 */
async function storeOTP(email, otp) {
  const now = new Date()
  now.setMinutes(now.getMinutes() + 10) // add 10 mins for OTP validity
  const time = now.toUTCString();

  const response = await dynamo.query({
    TableName: users_table,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: {
        ':e': { 'S': email }
    },
  })

  //return nothing if no user found
  if (!response.Items) {
    return {}
  }

  const userID = response.Items[0].userID.S
  const key = marshall({ userID: userID })

  return await dynamo.updateItem({
    TableName: users_table,
    Key: key,
    UpdateExpression: "SET otp = :o, otptime = :t",
    ExpressionAttributeValues: marshall({
      ":o": otp,
      ":t": time
    }),
  });

}

/**
 * Checks whether a password hash is equal to the one in database
 * @param {String} email 
 * @param {String} hash 
 * @returns userID or nothing
 */
async function checkPassword(email, hash) {

  const response = await dynamo.query({
    TableName: users_table,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: {
        ':e': { 'S': email }
    },
  })

  //break if no email maatch
  if (!response.Items) {
    return {}
  }

  //password match condition
  if (hash === response.Items[0].passhash.S) {
    //send the userID back
    return response.Items[0].userID.S
  }

  //return nothing if hash doesnt match
  return {}
}

/**
 * Checks OTP validity to see if it matches whats in database and its not yet expired
 * @param {String} email 
 * @param {String} otp 
 * @returns userID or nothing
 */
async function checkOTP(email, otp) {

  const response = await dynamo.query({
    TableName: users_table,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: {
        ':e': { 'S': email }
    },
  })

  //break if no email maatch
  if (!response.Items) {
    return {}
  }

  //OTP match condition
  if (otp === response.Items[0].otp.S) {
    //send the userID back
    return response.Items[0].userID.S
  }

  //return nothing if hash doesnt match
  return {}
}

/**
 * Fetches all the current sessions of the inputted userID
 * @param {String} userID 
 * @returns Array of sessionID's
 */
async function getSessions(userID) {

  const response = await dynamo.query({
    TableName: session_table,
    IndexName: 'userID-index',
    KeyConditionExpression: 'userID = :u',
    ExpressionAttributeValues: {
        ':u': { 'S': userID }
    },
  })

  //break if no sessions returned
  if (!response.Items) {
    return {}
  }

  var sessions = []
  //format sessions
  response.Items.forEach((session) => {
    sessions.push(session.sessionID.S)
  });
  return sessions;
}

/**
 * Verifies that the session token is legitimate and refreshes
 * @param {String} sessionID 
 * @returns updated session or nothing
 */
async function verifyToken(sessionID) {
  const key = marshall({ sessionID: sessionID })
  const currentTime = Date.now()
  const response = await dynamo.getItem({
    TableName: session_table,
    Key: key,
  })
  
  //break if no token found
  if (!response.Item) {
    return {}
  }

  let session = unmarshall(response.Item)

  //expired token logic
  if (currentTime >= session.expires) {
    if (session.isActive) {
      // invalidate session if session is active and it is expired
      dynamo.updateItem({
        TableName: session_table,
        Key: key,
        UpdateExpression: "SET isActive = :isActive",
        ExpressionAttributeValues: marshall({
          isActive: false,
        }),
      })
      
      // return update session info
      return { ...session, isActive: false }
    }
    
    return session
  }

  //otherwise return session with new expiry date
  const newExpires = currentTime + 1000 * 60 * 60 * 24 * 30 // 30 days from now
  // extend session
  dynamo.updateItem({
    TableName: session_table,
    Key: key,
    UpdateExpression: "SET expires = :expires",
    ExpressionAttributeValues: marshall({
      ":expires": newExpires,
    }),
  })

  // return session info with new expiry date
  return { ...session, expires: newExpires }
}

/**
 * Invalidates a session
 * @param {String} sessionID 
 * @returns Session Attributes
 */
async function invalidateSession(sessionID) {
  const key = marshall({ sessionID: sessionID })
  const session = await dynamo.updateItem({
    TableName: session_table,
    Key: key,
    UpdateExpression: "SET isActive = :isActive",
    ExpressionAttributeValues: marshall({
      ":isActive": false,
    }),
    ReturnValues: "ALL_NEW",
  })
  console.log(session.Attributes)
  return unmarshall(session.Attributes)
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
 */
app.post("/register", async (req, res, next) => {
  const email = req.body.email
  const hash = req.body.passhash
  const userID = uuidv4()
  const created = await createUser(email, hash, userID);
  if (created) {
    // ISSUING TOKEN ON SUCCESS
    var session = await createSession(userID)
    return res.status(200).send(session);
  }

  return res.status(403).send("USEREXISTS");
});

/**
 * Logs in a user
 */
app.post("/login", async (req, res, next) => {
  const email = req.body.email
  const hash = req.body.passhash
  const userID = await checkPassword(email, hash);
  if (userID) {
    // ISSUING TOKEN ON SUCCESS
    var session = await createSession(userID)
    return res.status(200).send(session);
  }

  return res.status(403).send("INVALID");
});

/**
 * Updates a users password
 */
app.post("/updatepassword", async (req, res, next) => {
  const email = req.body.email
  const hash = req.body.passhash
  const otp = req.body.otp

  //do some otp verification logic here
  const userID = await checkOTP(email, otp)

  //failed OTP check
  if (!userID) {
    return res.status(403).send("FAILURE");
  }

  //send updated hash to database
  const updated = await updatePassword(userID, hash);
  if (updated) {
    //invalidate current sessions
    //grab current sessions under their id
    const sessions = await getSessions(userID)
    if (sessions.length > 0) {
      sessions.forEach((session) => {
        invalidateSession(session)
      })
    }
    return res.status(200).send("SUCCESS");
  }
  return res.status(403).send("FAILURE");
  
});

/**
 * Sends the user a one time OTP that expires in 10 mins
 */
app.post("/sendotp", async (req, res, next) => {
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

  //TODO
  //email to user

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
      expires: token.expires
    });
  }
  return res.status(403).send("INVALIDTOKEN");
});

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

module.exports.handler = serverless(app);
