import express from "express";
import { EventSource } from "eventsource";

const app = express();

console.log("Starting minimal test...");

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(3100, () => {
  console.log("Express listening on 3100");
  
  console.log("Creating EventSource...");
  const es = new EventSource("http://localhost:3000/stream");
  
  es.onopen = () => {
    console.log("EventSource connected!");
  };
  
  es.onerror = (err) => {
    console.error("EventSource error:", err);
  };
  
  es.onmessage = (msg) => {
    console.log("Message:", msg.data);
  };
  
  console.log("EventSource created, waiting for events...");
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});
