const socket = io();

// global state
let me; // my Socket ID
let isAudioStarted = false; 

// data structures
let experienceState = { users: {} };
let trails = {};       // user trails { socketId: [{x,y}, {x,y}...] }
let userSynths = {};   // user audio objects { socketId: { synth, volume, loop, chord } }

// constants
const MAX_TRAIL_LENGTH = 60; // length of the trail
const SEND_RATE = 30;        // frequency of sending data
let lastSent = 0;            // throttle timer

// music scale
const CHORD_PALETTE = [
  ["C4", "E4", "G4", "B4"],  // C Maj7
  ["A3", "C4", "E4", "G4"],  // A Min7
  ["F3", "A3", "C4", "E4"],  // F Maj7
  ["G3", "B3", "D4", "F4"],  // G Dom7
  ["D4", "F4", "A4", "C5"],  // D Min7
  ["E4", "G4", "B4", "D5"]   // E Min7
];

// setup darw

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 1); // hsb colormode
  noStroke();
  textAlign(CENTER, CENTER);
}
// sketch.js

function draw() {
  background(240, 0, 10, 0.2); 

  // reminder
  if (!isAudioStarted) {
    fill(255);
    textSize(20);
    text("START", width / 2, height / 2);
    return; //stop
  }

  // draw trails
  noFill();
  strokeWeight(2);

  for (let id in trails) {
    let u = experienceState.users[id];
    let t = trails[id];

    if (u && t.length > 1) {
      stroke(u.hue, 80, 90); // color

      beginShape();
      for (let i = 0; i < t.length; i++) {
        
        if (id === me) {
          vertex(t[i].x, t[i].y);
        } else {
          vertex(t[i].x * width, t[i].y * height);
        }
      }
      endShape();
    }
  }

  // avatars
  noStroke();
  for (let id in experienceState.users) {
    const u = experienceState.users[id];
    
    // pulse effect 
    let pulse = sin(frameCount * 0.1) * 5;
    
    if (id === me) {
      //debug
      // fill(u.hue, 100, 100);
      // circle(mouseX, mouseY, 20 + pulse);
    } else {
      fill(u.hue, 100, 100);
      circle(u.x * width, u.y * height, 20 + pulse);
    }
  }
}

// interactions

function mousePressed() {
  // AudioContext
  if (!isAudioStarted) {
    Tone.start();
    Tone.Transport.start(); 
    isAudioStarted = true;

    // initialze
    if (me && experienceState.users[me]) {
      initSynthForUser(me, experienceState.users[me].soundIndex);
    }
    
    // initialize existing users 
    for (let id in experienceState.users) {
      if (id !== me) {
        initSynthForUser(id, experienceState.users[id].soundIndex);
      }
    }
  }
}

function mouseMoved() {
  if (!isAudioStarted) return;

  let now = millis();

  // update my trail
  if (!trails[me]) trails[me] = [];

  // record 
  let prevPoint = trails[me].length > 0 ? trails[me][trails[me].length - 1] : { x: mouseX, y: mouseY };
  let currentPoint = { x: mouseX, y: mouseY };

  trails[me].push(currentPoint);
  if (trails[me].length > MAX_TRAIL_LENGTH) trails[me].shift();

  // sidechain trigger
  checkCrossings(prevPoint, currentPoint);

  // throttle position updates to server
  if (now - lastSent < SEND_RATE) return;
  lastSent = now;

  socket.emit("move", {
    x: mouseX / width,
    y: mouseY / height
  });
}

// Tone.js

function initSynthForUser(id, soundIndex) {
  // cleanup
  if (userSynths[id]) {
    cleanupSynth(id);
  }

  // chords
  let chordIndex = soundIndex % CHORD_PALETTE.length;
  let myChord = CHORD_PALETTE[chordIndex];

  // randomize envelope 
  let atk = random(0.05, 2.0);  
  let rel = random(0.5, 4.0);

  // setup volume node 
  let volNode = new Tone.Volume(-15).toDestination();

  // setup synth
  let synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: {
      type: random(["triangle", "sine", "sawtooth"]) 
    },
    envelope: {
      attack: atk,
      decay: 0.3,
      sustain: 0.5,
      release: rel
    }
  }).connect(volNode);

  // setup loop
  let interval = random(["2m", "4m"]);
  
  const loop = new Tone.Loop(time => {
    
    synth.triggerAttackRelease(myChord, interval, time);
  }, interval).start(random(0, 2)); 

  console.log(`User ${id} sound ready. Chord: ${chordIndex}`);

  userSynths[id] = {
    synth: synth,
    volume: volNode,
    loop: loop
  };
}

// Sidechain 
function triggerSidechain(victimId) {
  let uSound = userSynths[victimId];
  
  if (uSound) {
    const now = Tone.now();
    
    // visual feedback
    let u = experienceState.users[victimId];
    if(u) {
      push();
      noFill();
      stroke(0, 0, 100); // White in HSB
      strokeWeight(50);
      circle(u.x * width, u.y * height, 100);
      pop();
    }

    // ducking effect
    // 1. cancel current volume automation
    uSound.volume.volume.cancelScheduledValues(now);
    // 2. immediately drop to -100dB 
    uSound.volume.volume.rampTo(-100, 0.05, now);
    // 3. return to normal over senconds
    uSound.volume.volume.rampTo(-15, 1.0, now + 0.1);
  }
}

function cleanupSynth(id) {
  if (userSynths[id]) {
    try {
      userSynths[id].synth.releaseAll();
      userSynths[id].synth.dispose();
      userSynths[id].volume.dispose();
      userSynths[id].loop.dispose();
    } catch(e) {
      console.log("Cleanup error", e);
    }
    delete userSynths[id];
  }
}

// geometry utils

function checkCrossings(p1, p2) {
  // p1, p2 
  
  for (let otherId in trails) {
    if (otherId === me) continue; 

    let otherTrail = trails[otherId];
    
    // otherTrail 
    for (let i = 0; i < otherTrail.length - 1; i++) {
      // transform to screen coordinates
      let o1 = { x: otherTrail[i].x * width, y: otherTrail[i].y * height };
      let o2 = { x: otherTrail[i+1].x * width, y: otherTrail[i+1].y * height };

      // detect intersection
      if (lineLineIntersection(p1.x, p1.y, p2.x, p2.y, o1.x, o1.y, o2.x, o2.y)) {
        triggerSidechain(otherId); // trigger sidechain on the other user
        return; // once per move
      }
    }
  }
}

// interaction agorithm
function lineLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  let uA = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x3-x4)*(y2-y1));
  let uB = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x3-x4)*(y2-y1));
  return (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1);
}

// SOCKET EVENTS 

socket.on("init", (data) => {
  me = data.id;
  experienceState = data.state;

  // initialize existing user data structures
  for(let id in experienceState.users){
    trails[id] = [];
  }

  // If joined later and have already clicked start, initialize sound
  if(isAudioStarted) {
    initSynthForUser(me, experienceState.users[me].soundIndex);
    for(let id in experienceState.users){
      if(id !== me) initSynthForUser(id, experienceState.users[id].soundIndex);
    }
  }
});

socket.on("userJoined", (data) => {
  console.log("New user joined", data.id);
  experienceState.users[data.id] = data.user;
  trails[data.id] = []; // prepare empty trail
  
  if(isAudioStarted) {
    initSynthForUser(data.id, data.user.soundIndex);
  }
});

socket.on("userLeft", (id) => {
  delete experienceState.users[id];
  delete trails[id];
  cleanupSynth(id); // stop sound
});

socket.on("userMoved", (data) => {
  let id = data.id;
  if (experienceState.users[id]) {
    experienceState.users[id].x = data.x;
    experienceState.users[id].y = data.y;
    
    // update trail
    if (!trails[id]) trails[id] = [];
    trails[id].push({x: data.x, y: data.y});
    if (trails[id].length > MAX_TRAIL_LENGTH) trails[id].shift();
  }
});

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
}