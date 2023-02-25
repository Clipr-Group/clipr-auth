//serverless & express stuff
const serverless = require("serverless-http");
const express = require("express");
const app = express();
const bodyParser = require('body-parser');

//handle posts
app.use(bodyParser.json());

//token stuff
const fs   = require('fs');
const jwt  = require('jsonwebtoken');
const privateKEY  = fs.readFileSync('./auth_priv.key', 'utf8');
const publicKEY  = fs.readFileSync('./auth_pub.key', 'utf8');
const issuer  = 'Clipr';          // Issuer 
const subject = 'clipr.app'

//DyanmoDB stuff
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const REGION = process.env.AWS_REGION;
const users_table = "clipr-auth-users";
const token_blacklist_table = "clipr-auth-token-blacklist";
const dynamo = new DynamoDB({ region: REGION })

function createToken(email, version) {
  //default token payload
  var payload = {
    version: version
  };
  var signOptions = {
    issuer:  issuer,
    subject:  subject,
    audience:  email,
    expiresIn:  "8h",
    algorithm:  "RS256"
  };

  return jwt.sign(payload, privateKEY, signOptions)
}

async function createUser(email, hash) {
  const user = {
    email: email,
    passhash: hash
  }

  var p = new Promise((resolve, reject) => {
    dynamo.putItem({
      TableName: users_table,
      Item: marshall(user),
      ConditionExpression: 'attribute_not_exists(email)'
    }, function(err) {
      if (err) {
        console.log("USER EXISTS");
        resolve(false)
      } else {
        resolve(true)
      }
    });
  });
  
  return await p;
}

async function updatePassword(email, hash) {
  const key = marshall({ email: email })

  return await dynamo.updateItem({
    TableName: users_table,
    Key: key,
    UpdateExpression: "SET passhash = :h",
    ExpressionAttributeValues: marshall({
      ":h": hash,
    }),
  });
}

async function storeOTP(email, otp) {
  const key = marshall({ email: email })
  const now = new Date()
  now.setMinutes(now.getMinutes() + 10) // add 10 mins for OTP validity
  const time = now.toUTCString();

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

async function invalidateToken(email) {
  const key = marshall({ email: email })

  return await dynamo.updateItem({
    TableName: token_blacklist_table,
    Key: key,
    UpdateExpression: "SET tokenversion = :t",
    ExpressionAttributeValues: marshall({
      ":t": 1
    })
  })
}


app.get("/", (req, res, next) => {
  return res.status(200).json({
    message: "Hello from root!",
  });
});

app.post("/register", async (req, res, next) => {
  const email = req.body.email
  const hash = req.body.passhash

  const created = await createUser(email, hash);
  console.log(created)
  if (created) {
    // ISSUING TOKEN ON SUCCESS
    var token = createToken(email, 1);
    return res.status(200).send(token);
  }

  return res.status(401).send("USEREXISTS");
});

app.post("/updatepassword", async (req, res, next) => {
  const email = req.body.email
  const hash = req.body.passhash
  const otp = req.body.otp

  //do some otp verification logic here
  const key = marshall({ email: email })
  const response = await dynamo.getItem({
    TableName: users_table,
    Key: key,
  })

  var result = unmarshall(response.Item)


  //send updated hash to database
  const updated = await updatePassword(email, hash);
  if (updated) {
    //grab current token version
    
    //invalidate token version

    return res.status(200).send("SUCCESS");
  }
  return res.status(401).send("FAILURE");
  
});

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

app.get("/getToken", (req, res, next) => {
  
  // SIGNING OPTIONS
  var token = createToken("kooshpatel@gmail.com", 1)
  return res.status(200).send(token);
});

app.get("/verifyToken", (req, res, next) => {
  const token = req.headers.authorization.split(' ')[1] 
  var legit = jwt.verify(token, publicKEY)
  return res.status(200).send(legit);
});

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

module.exports.handler = serverless(app);
