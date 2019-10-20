const request = require("request");
const functions = require('firebase-functions');
var admin = require("firebase-admin");

var serviceAccount = require("./the-great-gazoo-shop-firebase-adminsdk-vojgn-24d38f15e9.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://the-great-gazoo-shop.firebaseio.com"
});

let db = admin.firestore();

exports.refreshGenesysAPIToken = functions.pubsub.schedule('every 59 minutes').onRun((context) => {

    var options = {
        url: 'https://api.genesysappliedresearch.com/v2/knowledge/generatetoken',
        headers: {
            'cache-control': 'no-cache',
            secretkey: '8567a7ee-8623-4b92-a112-17f0a755572a',
            organizationid: '507c6b94-d35a-48ce-9937-c2e4aa69c279'
        },
        json: true
    };

    request.post(options, function (error, response, body) {
        if (error) throw new Error(error);

        try {
            return db.collection('config')
                .doc('genesys-api')
                .update({
                    token: body.token,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
        } catch (err) {
            console.log(err);
        }
    });
});
