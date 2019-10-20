/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
"use strict";

var isLoaded = false;

// Signs-in Friendly Chat.
let genesysAPI;

function signIn() {
  // Sign into Firebase using popup auth & Google as the identity provider.
  var provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider);
}

// Signs-out of Friendly Chat.
function signOut() {
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

// Returns true if a user is signed-in.
function isUserSignedIn() {
  return !!firebase.auth().currentUser;
}

// Saves a new message on the Firebase DB.
function saveMessage(messageText) {
  // Add a new message entry to the database.
  return firebase
    .firestore()
    .collection("users")
    .doc(getUserID())
    .collection("messages")
    .add({
      name: getUserName(),
      text: messageText,
      profilePicUrl: getProfilePicUrl(),
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    })
    .catch(function(error) {
      console.error("Error writing new message to database", error);
    });
}

// Loads chat messages history and listens for upcoming ones.
function loadMessages() {
  // Create the query to load the last 12 messages and listen for new ones.
  var query = firebase
    .firestore()
    .collection("users")
    .doc(getUserID())
    .collection("messages")
    .orderBy("timestamp", "desc")
    .limit(12);

  var queryToken = firebase
    .firestore()
    .collection("config")
    .doc("genesys-api");

  // Start listening to the query.
  queryToken.onSnapshot(doc => {
    if (doc.exists) {
      genesysAPI = doc.data();
      console.log(genesysAPI);
    }
  });
  query.onSnapshot(function(snapshot) {
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
          message.imageUrl
        );
      }
    });
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
  firebase
    .messaging()
    .getToken()
    .then(function(currentToken) {
      if (currentToken) {
        console.log("Got FCM device token:", currentToken);
        // Saving the Device Token to the datastore.
        firebase
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

// Triggered when the send new message form is submitted.
function onMessageFormSubmit(e) {
  e.preventDefault();
  const message = messageInputElement.value;
  if (messageInputElement.value.length <= 4) {
    alert("Message is too short. Please type more than 5 characters.");
    return;
  }
  // Check that the user entered a message and is signed in.
  if (message && checkSignedInWithMessage()) {
    agentIsTyping.style.display = "block";
    saveMessage(message).then(function() {
      if (genesysAPI && genesysAPI.token) {
        fetch(
          "https://cors-anywhere.herokuapp.com/https://api.genesysappliedresearch.com/v2/knowledge/knowledgebases/fa914326-e031-4564-a2a5-2fa08e9e4660/search",
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
        )
          .then(function(response) {
            if (response.status !== 200) {
              console.log(
                "Looks like there was a problem. Status Code: " +
                  response.status
              );
              return;
            }

            // Examine the text in the response
            response.json().then(function(data) {
              if (data.results) {
                agentIsTyping.style.display = "none";
                console.log(data.results);
              }
            });
          })
          .catch(function(err) {
            console.log("Fetch Error :-S", err);
          });
      } else {
        alert("Genesys down!");
      }

      // Clear message text field and re-enable the SEND button.
      resetMaterialTextfield(messageInputElement);
      toggleButton();
    });
  }
}

// Triggers when the auth state change for instance when the user signs-in or signs-out.
function authStateObserver(user) {
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
    saveMessagingDeviceToken();
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
    isLoaded = true;
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
function displayMessage(id, timestamp, name, text, picUrl, imageUrl, fromId) {
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
    messageElement.textContent = text;
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
var imageButtonElement = document.getElementById("submitImage");
var imageFormElement = document.getElementById("image-form");
var mediaCaptureElement = document.getElementById("mediaCapture");
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
imageButtonElement.addEventListener("click", function(e) {
  e.preventDefault();
  mediaCaptureElement.click();
});
mediaCaptureElement.addEventListener("change", onMediaFileSelected);

// initialize Firebase
initFirebaseAuth();

// Remove the warning about timstamps change.
var firestore = firebase.firestore();

// TODO: Enable Firebase Performance Monitoring.
firebase.performance();
