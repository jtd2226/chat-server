function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        function (c) {
            var r = (Math.random() * 16) | 0,
                v = c == "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        }
    );
}

function mapQueryValues(snap) {
    return Object.entries(snap.val() || {}).map(([key, value]) => ({
      id: key,
      ...value,
    }));
}

function validateQueryParams(query, ...params) {
    return params.reduce(
        (r, v) => ({
        ...r,
        [v]: query[v],
        errors: query[v] ? r.errors : `${r.errors || 'You are missing the following required query param(s):'}\n${v}`,
        }),
        {}
    );
}

const admin = require('firebase-admin')
if (!admin.apps.length) admin.initializeApp();
const db = admin.app().database(process.env.FIREBASE_URL)

const socket = {
    on: name => new Promise((resolve, reject) => 
        db.ref(name)
            .on('value', snap => resolve(mapQueryValues(snap)))
            .catch(reject)),
    emit: (name, data) => db.ref(name).push(data)
}

let users = {};
let serverUsers = {};
let connectedUsers = {};
let ips = {};
let messages = [];

function toString(val) {
    return JSON.stringify(val);
}

const updateUsers = (socket, user) => {
    if (user) {
        if (!user.id) {
            user.id = uuidv4();
            socket.emit("id", user.id);
            console.log(`Issuing new user identifier: ${user.id}`);
        }
        if (!user.name) user.name = "anonymous";

        users[user.id] = user.name;
        serverUsers[socket.id] = user;
        if (connectedUsers[user.id]) {
            socket.emit("users", users);
            console.log(`User re-connecting: ${toString(user)}`);
        } else {
            socket.emit("users", users);
            console.log(`User connecting: ${toString(user)}`);
        }
        connectedUsers[user.id] = connectedUsers[user.id] || new Set();
        connectedUsers[user.id].add(socket.id);
        socket.emit("message", messages);
    } else {
        const disconnectedUser = { ...serverUsers[socket.id] };
        delete serverUsers[socket.id];
        const userSockets = connectedUsers[disconnectedUser.id];
        if (!userSockets) return;
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
            delete ips[disconnectedUser.id];
            delete connectedUsers[disconnectedUser.id];
            delete users[disconnectedUser.id];
            socket.emit("users", users);
            socket.emit("ip", ips);
            console.log(`User disconnected: ${toString(disconnectedUser)}`);
        }
    }
};

module.exports = (req, res) => {
    socket.emit("message", messages);
    socket.emit("users", users);
    socket.on("message").then( (msg) => {
        messages.push({
            id: uuidv4(),
            senderId: serverUsers[socket.id].id,
            username: serverUsers[socket.id].name,
            value: msg.value,
            code: msg.code,
            timestamp: new Date().toUTCString(),
        });
        if (messages.length > 25) messages.shift();
        socket.emit("message", messages);
    });
    socket.on("newuser").then((user) => updateUsers(socket, user));
    socket.on("disconnect").then((reason) => {
        console.log(`Socket disconnected: ${reason}`);
        updateUsers(socket);
    });
    socket.on("ip").then((data) => {
        const user = { ...serverUsers[socket.id] };
        ips[user.id] = { ...user, ip: data.ip };
        socket.emit("ip", ips);
    });
    res.status(200).end("done")
}
