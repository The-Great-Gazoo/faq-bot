"use strict";

var isLoaded = false;
var isHelpingUserID = false;
var isGettingHelpedByID = false;
var unsubscribeGettingHelped = false;
var lastReferenceContext = false;

const bracketRegexp = new RegExp(/\[([^)]+)\]/);

const initMessage = `Hi $user! Welcome to Gazoo Spaceship support centre. I am your host, Gazoo, and I will be answering all your Gazoo Spaceship maintenance related questions.

Some topics you can ask me are: what to do when brakes squeak, when to do oil change, which type of wiper blades to use.

So, how can I help you?`;

// Signs-in Friendly Chat.
let genesysAPI;
const gazooProfile = `/images/gazoo-avatar.png`;

async function signIn() {
  // Sign into Firebase using popup auth & Google as the identity provider.
  var provider = new firebase.auth.GoogleAuthProvider();
  await firebase.auth().signInWithPopup(provider);

  var queryAgent = firebase
    .firestore()
    .collection("agents")
    .doc(getUserEmail());

  queryAgent.get().then(doc => {
    if (doc.exists) {
      var agentData = doc.data();

      if (agentData.status === "online") {
        var timestamp = Date.now();
        var agentTimestamp = agentData.timestamp.toDate().getTime();

        // only update agent data in firestore every 15mins
        if (agentTimestamp < timestamp - 15 * 60) {
          return;
        }
      }

      firebase
        .firestore()
        .collection("agents")
        .doc(doc.id)
        .update({
          uid: getUserID(),
          status: "online",
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

      setUserAsGazooAgent();
    }
  });
}

// Signs-out of Friendly Chat.
async function signOut() {
  var uid = getUserID();
  var userEmail = getUserEmail();

  const doc = await firebase
    .firestore()
    .collection("agents")
    .doc(userEmail)
    .get();

  if (doc.exists) {
    await firebase
      .firestore()
      .collection("agents")
      .doc(doc.id)
      .update({
        uid: uid,
        status: "offline",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
  }

  // Sign out of Firebase.
  firebase.auth().signOut();
}

// Initiate firebase auth.
function initFirebaseAuth() {
  // Listen to auth state changes.
  firebase.auth().onAuthStateChanged(authStateObserver);
}

// Returns the signed-in user's profile Pic URL.
function getProfilePicUrl() {
  console.log(firebase.auth().currentUser.photoURL);
  return (
    firebase.auth().currentUser.photoURL || "/images/profile_placeholder.png"
  );
}

// Returns the signed-in user's display name.
function getUserName() {
  return firebase.auth().currentUser.displayName;
}

// Returns the signed-in users' ID
function getUserID() {
  return firebase.auth().currentUser.uid;
}

// Returns the signed-in users' ID
function getUserEmail() {
  return firebase.auth().currentUser.email;
}

function setUserAsGazooAgent() {
  firebase.auth().currentUser.isGazooAgent = true;
}

function isUserGazooAgent() {
  return !!firebase.auth().currentUser.isGazooAgent;
}

// Returns true if a user is signed-in.
function isUserSignedIn() {
  return !!firebase.auth().currentUser;
}

// Saves a new message on the Firebase DB.
function saveMessage({
  question,
  answer,
  userName = getUserName(),
  profile = getProfilePicUrl(),
  customization,
  confidence,
  uid = getUserID(),
  agentRequest,
  recipientName = getUserName()
}) {
  // Add a new message entry to the database.
  const response = {
    uid,
    name: userName,
    text: answer,
    profilePicUrl: profile,
    recipientName,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (question) {
    response.question = question;
  }
  if (customization) {
    response.customization = customization;
  }
  if (confidence) {
    response.confidence = confidence;
  }
  if (agentRequest) {
    response.agentRequest = true;
    response.fromUid = getUserID();
  }
  console.log(response);
  return firebase
    .firestore()
    .collection("users")
    .doc(uid)
    .collection("messages")
    .add(response)
    .catch(function(error) {
      console.error("Error writing new message to database", error);
    });
}

// Loads chat messages history and listens for upcoming ones.
function loadMessages() {
  if (!firebase.auth().currentUser) {
    return;
  }
  isLoaded = true;

  var queryGenesysAPI = firebase
    .firestore()
    .collection("config")
    .doc("genesys-api");

  // Start listening to the query.
  queryGenesysAPI.onSnapshot(doc => {
    if (doc.exists) {
      genesysAPI = doc.data();
      console.log(genesysAPI);
    }
  });

  // Create the query to load the last 12 messages and listen for new ones.
  var queryMessages = firebase
    .firestore()
    .collection("users")
    .doc(getUserID())
    .collection("messages")
    .orderBy("timestamp", "desc")
    .limit(12);
  queryMessages.onSnapshot(function(snapshot) {
    const messageLength = snapshot.docChanges().length;
    if (messageLength === 0) {
      saveMessage({
        answer: initMessage,
        // Send as Gazoo
        userName: genesysAPI.botname,
        profile: gazooProfile
      });
    } else {
      snapshot.docChanges().forEach(function(change) {
        if (change.type === "removed") {
          deleteMessage(change.doc.id);
        } else {
          var message = change.doc.data();
          if (!isHelpingUserID) {
            displayMessage(
              change.doc.id,
              message.timestamp,
              message.name,
              message.text,
              message.profilePicUrl,
              message.imageUrl,
              message.customization,
              message.confidence,
              message.fromUid,
              message.recipientName
            );
          }
        }
      });
    }
  });
}

// Saves a new message containing an image in Firebase.
// This first saves the image in Firebase storage.
function saveImageMessage(file) {
  // 1 - We add a message with a loading icon that will get updated with the shared image.
  firebase
    .firestore()
    .collection("users")
    .doc(getUserID())
    .collection("messages")
    .add({
      name: getUserName(),
      imageUrl: LOADING_IMAGE_URL,
      profilePicUrl: getProfilePicUrl(),
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(function(messageRef) {
      // 2 - Upload the image to Cloud Storage.
      var filePath =
        firebase.auth().currentUser.uid + "/" + messageRef.id + "/" + file.name;
      return firebase
        .storage()
        .ref(filePath)
        .put(file)
        .then(function(fileSnapshot) {
          // 3 - Generate a public URL for the file.
          return fileSnapshot.ref.getDownloadURL().then(url => {
            // 4 - Update the chat message placeholder with the image's URL.
            return messageRef.update({
              imageUrl: url,
              storageUri: fileSnapshot.metadata.fullPath
            });
          });
        });
    })
    .catch(function(error) {
      console.error(
        "There was an error uploading a file to Cloud Storage:",
        error
      );
    });
}

// Saves the messaging device token to the datastore.
function saveMessagingDeviceToken() {
  return firebase
    .messaging()
    .getToken()
    .then(function(currentToken) {
      if (currentToken) {
        console.log("Got FCM device token:", currentToken);
        // Saving the Device Token to the datastore.
        return firebase
          .firestore()
          .collection("fcmTokens")
          .doc(currentToken)
          .set({ uid: firebase.auth().currentUser.uid });
      } else {
        // Need to request permissions to show notifications.
        requestNotificationsPermissions();
      }
    })
    .catch(function(error) {
      console.error("Unable to get messaging token.", error);
    });
}

// Requests permissions to show notifications.
function requestNotificationsPermissions() {
  console.log("Requesting notifications permission...");
  firebase
    .messaging()
    .requestPermission()
    .then(function() {
      // Notification permission granted.
      saveMessagingDeviceToken();
    })
    .catch(function(error) {
      console.error("Unable to get permission to notify.", error);
    });
}

// Triggered when a file is selected via the media picker.
function onMediaFileSelected(event) {
  event.preventDefault();
  var file = event.target.files[0];

  // Clear the selection in the file picker input.
  imageFormElement.reset();

  // Check if the file is an image.
  if (!file.type.match("image.*")) {
    var data = {
      message: "You can only share images",
      timeout: 2000
    };
    signInSnackbarElement.MaterialSnackbar.showSnackbar(data);
    return;
  }
  // Check if the user is signed-in
  if (checkSignedInWithMessage()) {
    saveImageMessage(file);
  }
}

function getFAQAnswer(results) {
  try {
    const data = results[0].faq;
    data.confidence = results[0].confidence;
    return data;
  } catch (err) {
    const customization = JSON.stringify({
      type: "buttons-request-agent",
      values: ["yes", "no"]
    });

    return {
      customization,
      answer:
        "Sorry, I don't know the answer to that yet. Would you like to speak with a Gazoo Certified Agent?"
    };
  }
}

async function getBotResponse({ message, KB = "spaceshipKB" }) {
  if (!genesysAPI || !genesysAPI.token || !genesysAPI[KB]) {
    alert("Genesys down!");
  }
  try {
    const response = await fetch(
      `https://cors-anywhere.herokuapp.com/https://api.genesysappliedresearch.com/v2/knowledge/knowledgebases/${genesysAPI[KB]}/search`,
      {
        method: "POST",
        headers: {
          "cache-control": "no-cache",
          token: genesysAPI.token,
          organizationid: "507c6b94-d35a-48ce-9937-c2e4aa69c279",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: message,
          pageSize: 1,
          pageNumber: 1,
          sortOrder: "string",
          sortBy: "string",
          languageCode: "en-US",
          documentType: "Faq"
        }),
        json: true
      }
    );
    if (response.status !== 200) {
      console.log(
        "Looks like there was a problem. Status Code: " + response.status
      );
      return;
    }

    // Examine the text in the response
    const data = await response.json();
    return data.results;
  } catch (err) {
    console.log("something went wrong", err);
  }
}

async function onAgentJoin(value, fromUid, recipientName) {
  let message;
  if (value === "yes") {
    message = "Okay, connecting...";
  } else {
    message = "Okay but no space beer for you!";
  }

  saveMessage({
    answer: message,
    // Send as Gazoo
    userName: genesysAPI.botname,
    profile: gazooProfile
  });

  if (value === "yes") {
    isHelpingUserID = fromUid;

    firebase
      .firestore()
      .collection("users")
      .doc(fromUid)
      .collection("agentAssistance")
      .add({
        agentId: getUserID(),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

    saveMessage({
      answer: "Hi $user, how can I help you?",
      uid: fromUid,
      agentRequest: true,
      recipientName
    });

    var queryMessages = firebase
      .firestore()
      .collection("users")
      .doc(fromUid)
      .collection("messages")
      .orderBy("timestamp", "desc")
      .limit(12);

    queryMessages.onSnapshot(function(snapshot) {
      snapshot.docChanges().forEach(function(change) {
        if (change.type === "removed") {
          deleteMessage(change.doc.id);
        } else {
          var message = change.doc.data();
          displayMessage(
            change.doc.id,
            message.timestamp,
            message.name,
            message.text,
            message.profilePicUrl,
            message.imageUrl,
            message.customization,
            message.confidence,
            message.fromUid,
            message.recipientName
          );
        }
      });
    });
  }
}
async function onAgentResponse(value, recipientName) {
  let message;
  if (value === "yes") {
    message = "Okay. An agent is going to assist you shortly.";
  } else {
    message =
      "No problem. Do you have any other concerns or questions I could help you with?";
  }
  saveMessage({
    answer: message,
    // Send as Gazoo
    userName: genesysAPI.botname,
    profile: gazooProfile
  });

  if (value === "yes") {
    var queryAgents = firebase
      .firestore()
      .collection("agents")
      .where("status", "==", "online")
      .orderBy("timestamp", "desc")
      .limit(12);

    queryAgents.onSnapshot(function(snapshot) {
      saveMessage({
        answer: `There is ${
          snapshot.docChanges().length
        } agent(s) available. Please hold.`,
        // Send as Gazoo
        userName: genesysAPI.botname,
        profile: gazooProfile
      });

      var queryAgentHelp = firebase
        .firestore()
        .collection("users")
        .doc(getUserID())
        .collection("agentAssistance")
        .orderBy("timestamp", "desc");

      unsubscribeGettingHelped = queryAgentHelp.onSnapshot(function(snapshot) {
        snapshot.docChanges().forEach(function(change) {
          if (change.type === "added") {
            isGettingHelpedByID = change.doc.data().agentId;
          }
        });
      });

      snapshot.docChanges().forEach(function(change) {
        var agent = change.doc.data();
        if (agent.uid != getUserID()) {
          const customization = JSON.stringify({
            type: "buttons-join-agent",
            values: ["yes", "no"]
          });
          saveMessage({
            answer: `${getUserName()} needs help. Go help!`,
            uid: agent.uid,
            userName: genesysAPI.botname,
            profile: gazooProfile,
            customization,
            agentRequest: true,
            recipientName
          });
        }
      });
    });
  }
}

// Triggered when the send new message form is submitted.
async function onMessageFormSubmit(e) {
  e.preventDefault();

  let message = messageInputElement.value;

  clearMessageField();

  // Check that the user entered a message and is signed in.
  if (message && checkSignedInWithMessage()) {
    if (isHelpingUserID || isGettingHelpedByID) {
      agentIsTyping.style.display = "none";
    } else {
      agentIsTyping.style.display = "block";
    }

    const messageParameters = {
      answer: message,
      agentRequest: isHelpingUserID ? true : false
    };
    if (isHelpingUserID || isGettingHelpedByID) {
      messageParameters.uid = isHelpingUserID || isGettingHelpedByID;
    }
    await saveMessage(messageParameters);

    console.log("isGettingHelpedByID", isGettingHelpedByID);
    console.log("isHelpingUserID", isHelpingUserID);

    if (isGettingHelpedByID || isHelpingUserID) {
      return;
    }

    if (lastReferenceContext) {
      message = message.replace("it", lastReferenceContext);
    }
    lastReferenceContext = false;

    const results = await getBotResponse({ message });

    agentIsTyping.style.display = "none";
    var { answer, question, customization, confidence } = getFAQAnswer(results);

    const matches = answer.match(bracketRegexp);
    if (matches && matches[1]) {
      lastReferenceContext = matches[1];
      answer = answer.replace(/[\[\]']+/g, ""); // Remove all brackets
    }

    console.log(results, question, answer, customization, confidence);

    saveMessage({
      answer,
      question,
      customization,
      confidence,
      // Send as Gazoo
      userName: genesysAPI.botname,
      profile: gazooProfile
    });
  }
}

function clearMessageField() {
  // Clear message text field and re-enable the SEND button.
  resetMaterialTextfield(messageInputElement);
  toggleButton();
}

// Triggers when the auth state change for instance when the user signs-in or signs-out.
async function authStateObserver(user) {
  if (user) {
    // User is signed in!
    // Get the signed-in user's profile pic and name.
    var profilePicUrl = getProfilePicUrl();
    var userName = getUserName();

    // Set the user's profile pic and name.
    userPicElement.style.backgroundImage =
      "url(" + addSizeToGoogleProfilePic(profilePicUrl) + ")";
    userNameElement.textContent = userName;

    // Show user's profile and sign-out button.
    userNameElement.removeAttribute("hidden");
    userPicElement.removeAttribute("hidden");
    signOutButtonElement.removeAttribute("hidden");

    // Hide sign-in button.
    signInButtonElement.setAttribute("hidden", "true");

    // We save the Firebase Messaging Device token and enable notifications.
    await saveMessagingDeviceToken();
  } else {
    // User is signed out!
    // Hide user's profile and sign-out button.
    userNameElement.setAttribute("hidden", "true");
    userPicElement.setAttribute("hidden", "true");
    signOutButtonElement.setAttribute("hidden", "true");

    // Show sign-in button.
    signInButtonElement.removeAttribute("hidden");
  }
  if (!isLoaded) {
    loadMessages();
  }
}

// Returns true if user is signed-in. Otherwise false and displays a message.
function checkSignedInWithMessage() {
  // Return true if the user is signed in Firebase
  if (isUserSignedIn()) {
    return true;
  }

  // Display a message to the user using a Toast.
  var data = {
    message: "You must sign-in first",
    timeout: 2000
  };
  signInSnackbarElement.MaterialSnackbar.showSnackbar(data);
  return false;
}

// Resets the given MaterialTextField.
function resetMaterialTextfield(element) {
  element.value = "";
  element.parentNode.MaterialTextfield.boundUpdateClassesHandler();
}

// Template for messages.
var MESSAGE_TEMPLATE =
  '<div class="message-container">' +
  '<div class="spacing"><div class="pic"></div></div>' +
  '<div class="message"></div>' +
  '<div class="name"></div>' +
  "</div>";

// Adds a size to Google Profile pics URLs.
function addSizeToGoogleProfilePic(url) {
  if (url.indexOf("googleusercontent.com") !== -1 && url.indexOf("?") === -1) {
    return url + "?sz=150";
  }
  return url;
}

// A loading image URL.
var LOADING_IMAGE_URL = "https://www.google.com/images/spin-32.gif?a";

// Delete a Message from the UI.
function deleteMessage(id) {
  var div = document.getElementById(id);
  // If an element for that message exists we delete it.
  if (div) {
    div.parentNode.removeChild(div);
  }
}

function createAndInsertMessage(id, timestamp) {
  const container = document.createElement("div");
  container.innerHTML = MESSAGE_TEMPLATE;
  const div = container.firstChild;
  div.setAttribute("id", id);

  // If timestamp is null, assume we've gotten a brand new message.
  // https://stackoverflow.com/a/47781432/4816918
  timestamp = timestamp ? timestamp.toMillis() : Date.now();
  div.setAttribute("timestamp", timestamp);

  // figure out where to insert new message
  const existingMessages = messageListElement.children;
  if (existingMessages.length === 0) {
    messageListElement.appendChild(div);
  } else {
    let messageListNode = existingMessages[0];

    while (messageListNode) {
      const messageListNodeTime = messageListNode.getAttribute("timestamp");

      if (!messageListNodeTime) {
        throw new Error(
          `Child ${messageListNode.id} has no 'timestamp' attribute`
        );
      }

      if (messageListNodeTime > timestamp) {
        break;
      }

      messageListNode = messageListNode.nextSibling;
    }

    messageListElement.insertBefore(div, messageListNode);
  }

  return div;
}

// Displays a Message in the UI.
function displayMessage(
  id,
  timestamp,
  name,
  text,
  picUrl,
  imageUrl,
  customization,
  confidence,
  fromUid,
  recipientName
) {
  var div =
    document.getElementById(id) || createAndInsertMessage(id, timestamp);

  // profile picture
  if (picUrl) {
    div.querySelector(".pic").style.backgroundImage =
      "url(" + addSizeToGoogleProfilePic(picUrl) + ")";
  }

  div.querySelector(".name").textContent = name;
  var messageElement = div.querySelector(".message");

  if (text) {
    // If the message is text.
    text = text.replace(
      "$user",
      recipientName ? `<strong>${recipientName}</strong>` : "user"
    );
    text = text.replace(
      "$date",
      `<strong>${new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      })}</strong>`
    );
    if (confidence <= 0.4) {
      text =
        "<strong>I am not sure I fully understand your question but here's an answer I found that might be helpful to you:</strong><br><br>" +
        text;
    }
    messageElement.innerHTML = text;
    // Replace all line breaks by <br>.
    messageElement.innerHTML = messageElement.innerHTML.replace(/\n/g, "<br>");
  } else if (imageUrl) {
    // If the message is an image.
    var image = document.createElement("img");
    image.addEventListener("load", function() {
      messageListElement.scrollTop = messageListElement.scrollHeight;
    });
    image.src = imageUrl + "&" + new Date().getTime();
    messageElement.innerHTML = "";
    messageElement.appendChild(image);
  }

  if (customization) {
    customization = JSON.parse(customization);
    if (
      customization.type === "buttons-request-agent" ||
      customization.type === "buttons-join-agent"
    ) {
      customization.values.forEach(value => {
        var button = document.createElement("button");
        button.textContent = value;
        button.setAttribute("class", "yes-no");
        button.onclick = function() {
          if (customization.type === "buttons-request-agent") {
            onAgentResponse(value, recipientName);
          } else if (customization.type === "buttons-join-agent") {
            onAgentJoin(value, fromUid, recipientName);
          }
        };
        messageElement.appendChild(button);
      });
    }
  }

  // Show the card fading-in and scroll to view the new message.
  setTimeout(function() {
    div.classList.add("visible");
  }, 1);
  messageListElement.scrollTop = messageListElement.scrollHeight;
  messageInputElement.focus();
}

// Enables or disables the submit button depending on the values of the input
// fields.
function toggleButton() {
  if (messageInputElement.value) {
    submitButtonElement.removeAttribute("disabled");
  } else {
    submitButtonElement.setAttribute("disabled", "true");
  }
}

// Checks that the Firebase SDK has been correctly setup and configured.
function checkSetup() {
  if (
    !window.firebase ||
    !(firebase.app instanceof Function) ||
    !firebase.app().options
  ) {
    window.alert(
      "You have not configured and imported the Firebase SDK. " +
        "Make sure you go through the codelab setup instructions and make " +
        "sure you are running the codelab using `firebase serve`"
    );
  }
}

// Checks that Firebase has been imported.
checkSetup();

// Shortcuts to DOM Elements.
var messageListElement = document.getElementById("messages");
var messageFormElement = document.getElementById("message-form");
var messageInputElement = document.getElementById("message");
var submitButtonElement = document.getElementById("submit");
// var imageButtonElement = document.getElementById("submitImage");
// var imageFormElement = document.getElementById("image-form");
// var mediaCaptureElement = document.getElementById("mediaCapture");
var userPicElement = document.getElementById("user-pic");
var userNameElement = document.getElementById("user-name");
var signInButtonElement = document.getElementById("sign-in");
var signOutButtonElement = document.getElementById("sign-out");
var signInSnackbarElement = document.getElementById("must-signin-snackbar");
var agentIsTyping = document.getElementById("agent-typing");

// Saves message on form submit.
messageFormElement.addEventListener("submit", onMessageFormSubmit);
signOutButtonElement.addEventListener("click", signOut);
signInButtonElement.addEventListener("click", signIn);

// Toggle for the button.
messageInputElement.addEventListener("keyup", toggleButton);
messageInputElement.addEventListener("change", toggleButton);

// Events for image upload.
// imageButtonElement.addEventListener("click", function(e) {
//   e.preventDefault();
//   mediaCaptureElement.click();
// });
// mediaCaptureElement.addEventListener("change", onMediaFileSelected);

// initialize Firebase
initFirebaseAuth();

// Remove the warning about timstamps change.
var firestore = firebase.firestore();

// TODO: Enable Firebase Performance Monitoring.
firebase.performance();
