import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3333;

// serve static files 
app.use(express.static("public"));

server.listen(port, () => {
  console.log(`Server listening on port: ${port}`);
});

// manage experience state
let experienceState = {
  users: {}, // user data
};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // init user state
  experienceState.users[socket.id] = {
    
    x: -10, 
    y: -10,
    
    soundIndex: Math.floor(Math.random() * 6), 
    hue: Math.floor(Math.random() * 360) 
  };

  //send initial state to the new user
  socket.emit("init", {
    id: socket.id,
    state: experienceState
  });

  // notify others about the new user
  socket.broadcast.emit("userJoined", {
    id: socket.id,
    user: experienceState.users[socket.id]
  });

  // define movement handler
  socket.on("move", (data) => {
    const user = experienceState.users[socket.id];
    if (!user) return;

    user.x = data.x;
    user.y = data.y;

    // update
    socket.broadcast.emit("userMoved", {
      id: socket.id,
      x: user.x,
      y: user.y
    });
  });

  //  disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete experienceState.users[socket.id];
    io.emit("userLeft", socket.id);
  });
});