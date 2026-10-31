"use client";

import { useState } from "react";

export default function TailgateLogsPage() {
  const [meetingTopic, setMeetingTopic] = useState("High-Voltage Switching & LOTO Verification");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [leadName, setLeadName] = useState("Kyle Ingalls (Electrical Lead)");
  const [attendeeCount, setAttendeeCount] = useState(14);
  const [hazardsDiscussed, setHazardsDiscussed] = useState("1. Arc flash boundaries near 4160V gear\n2. Overhead crane lifting operations\n3. Proper PPE and voltage detector bump testing");
  const [weatherConditions, setWeatherConditions] = useState("Clear, +2°C, Wind 15 km/h NW");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/tailgate-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingTopic, projectName, leadName, attendeeCount, hazardsDiscussed, weatherConditions })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Daily Safety Tailgate & Toolbox Meetings</h1>
        <p className="text-slate-400 mb-8">Record pre-shift safety meetings, hazard discussions, weather conditions, and crew attendance.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Topic / Focus</label>
              <input 
                type="text" 
                value={meetingTopic} 
                onChange={(e) => setMeetingTopic(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Project Name</label>
              <input 
                type="text" 
                value={projectName} 
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Leader / Host</label>
              <input 
                type="text" 
                value={leadName} 
                onChange={(e) => setLeadName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Crew Attendee Count</label>
              <input 
                type="number" 
                value={attendeeCount} 
                onChange={(e) => setAttendeeCount(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Weather & Site Conditions</label>
              <input 
                type="text" 
                value={weatherConditions} 
                onChange={(e) => setWeatherConditions(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Hazards Discussed & Control Measures</label>
            <textarea 
              rows={4}
              value={hazardsDiscussed} 
              onChange={(e) => setHazardsDiscussed(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Logging Tailgate Meeting..." : "Log Safety Tailgate Meeting & Attendance"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-rose-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-rose-400 mb-2">Tailgate Safety Meeting Logged Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
