const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();

const port = 12000;
const dbFileName = 'db.json';
const maxMessageOffset = 300;
const timedOutTime = 20000;
const kickInterval = 5000;
const cleanupInterval = 10000;

var clients = [];
var messages = [];
var connections = [];

app.use(bodyParser.json());

fs.readFile(dbFileName, (err, data) => {
    if (err) {
        console.log(`Could not load database: ${err}.`);
        fs.writeFile(dbFileName, JSON.stringify({clients, messages}), (err) => {
            if (err) console.log(`Could not create database: ${err}.\nData will NOT be saved.`);
            else console.log(`Successfully created the database.`);
        });
    } else {
        let jsonData = JSON.parse(data);
        if (jsonData.clients) {
            clients = jsonData.clients;
            console.log('Client data loaded.');
        } else console.log("Client data not found.");
        if (jsonData.messages) {
            messages = jsonData.messages;
            console.log('Messages data loaded.');
        } else console.log("Messages data not found.");
    }

    app.listen(port, () => {
        console.log(`Server is now running at port ${port}.`);
    });

    setInterval(kickInactive, kickInterval);
    setInterval(cleanup, cleanupInterval);
});

function getLastMessageId() {
    return messages.length > 0 ? messages[messages.length - 1].id : -1;
}

function addClient(name) {
    clients.push({'lm': getLastMessageId(), 'name': name});
    console.log(`Created client '${name}'.`);
}

function cleanup() {
    messageCleanup();
    updateDatabase();
}

function messageCleanup() {
    if (clients.length === 0) return;
    let currentMessageId = getLastMessageId();
    clients.forEach((val, i) => {
        if (val.lm - currentMessageId > 300) clients[i].lm = currentMessageId;
    });
    clients.sort((a, b) => a.lm < b.lm ? -1 : 1);
    removeMessagesOlderThan(clients[0].lm);
}

function addMessage(from, text) {
    messages.push({'id': getLastMessageId() + 1, 'from': from, 'text': text});
    console.log(`${from}: ${text}`);
}

function removeMessagesOlderThan(id) {
    let ind = messages.findIndex((val) => val.id === id);
    if (ind === -1) return;
    messages.splice(0, ind);
}

function updateDatabase() {
    fs.writeFile(dbFileName, JSON.stringify({clients, messages}), (err) => {
        if (err) console.log(`Could not update the database: ${err}.\nData will NOT be saved.`);
        else console.log(`Successfully updated the database.`);
    });
}

function receiveUserMessages(name) {
    let userIndex = clients.findIndex(val => val.name === name);
    console.log(`userIndex: ${userIndex}`);
    if (userIndex === -1) return [];
    let messageIndex = messages.findIndex(val => val.id === clients[userIndex].lm);
    console.log(`messageIndex: ${messageIndex}`);
    clients[userIndex].lm = getLastMessageId();
    if (messageIndex === -1) return messages;
    return messages.slice(messageIndex + 1, clients[userIndex].lm);
}

function updateConnection(name) {
    let connectionIndex = connections.findIndex(val => val.name === name);
    if (connectionIndex === -1) connections.push({'name': name, 'time': Date.now()});
    else connections[connectionIndex].time = Date.now();
}

function kickInactive() {
    if (connections.length === 0) return;
    let now = Date.now();
    connections.sort((a, b) => a.time > b.time ? -1 : 1);
    let last = -1;
    connections.forEach((val, i) => {
       if (now - val.time > timedOutTime) {
           addMessage(`System`, `${val.name} has disconnected (timed out).`)
       } else last = i;
    });
    if (last < 0) connections = [];
    else connections.splice(last + 1, connections.length - last - 1);

    console.log(`Connections: ${JSON.stringify(connections)}.`);
}

function disconnect(name) {
    let connectionIndex = connections.findIndex(val => val.name === name);
    if (connectionIndex === -1) return false;
    connections.splice(connectionIndex, 1);
    return true;
}

function isConnected(name) {
    return connections.findIndex(val => val.name === name) !== -1;
}

app.get('/addmessage', (req, res) => {
    if (req.body.from && req.body.text && isConnected(req.body.from)) {
        let client = clients.find(value => value.name === req.body.from);
        if (client === undefined) res.status(400).send();
        addMessage(req.body.from, req.body.text);
        let userMessages = receiveUserMessages(req.body.from);
        res.status(200).json(userMessages);
    } else res.status(400).send();
});

app.get('/update', (req, res) => {
    if (req.body.from && isConnected(req.body.from)) {
        updateConnection(req.body.from);
        res.status(200).json(receiveUserMessages(req.body.from));
    } else res.status(400).send();
});

app.get('/connect', (req, res) => {
    if (req.body.from && !isConnected(req.body.from)) {
        if (clients.find(val => val.name === req.body.from) === undefined) addClient(req.body.from);
        updateConnection(req.body.from);
        addMessage(`Server`, `${req.body.from} has joined the chat.`);
        res.status(200).json(receiveUserMessages(req.body.from));
    } else res.status(400).send();
});

app.get('/disconnect', (req, res) => {
    if (req.body.from && isConnected(req.body.from) && disconnect(req.body.from)) {
        addMessage(`Server`, `${req.body.from} has left.`);
        res.status(200).send();
    } else res.status(400).send();
});
