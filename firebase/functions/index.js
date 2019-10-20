
const functions = require('firebase-functions');

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

exports.refreshGenesysAPIToken = functions.pubsub.schedule('every 59 minutes').onRun((context) => {
    var request = require("request");

    var options = { 
        method: 'POST',
        url: 'https://api.genesysappliedresearch.com/v2/knowledge/generatetoken',
        headers: {   
            'cache-control': 'no-cache',
            secretkey: '8567a7ee-8623-4b92-a112-17f0a755572a',
            organizationid: '507c6b94-d35a-48ce-9937-c2e4aa69c279' 
        } 
    };

    request(options, function (error, response, body) {
        if (error) throw new Error(error);

        const ref = firebase.firestore().collection('config').doc('genesys-api');
        ref.get().then((doc) => {
            if(doc.exists()){
                ref.update({token: body.token});
            }
        });
    });
});
