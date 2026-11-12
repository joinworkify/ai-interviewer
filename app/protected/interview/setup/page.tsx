"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export default function SetupPage() {
  const [micStatus, setMicStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [speakerStatus, setSpeakerStatus] = useState<"idle" | "playing" | "success">("idle");
  const router = useRouter();

  const testMicrophone = async () => {
    setMicStatus("testing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicStatus("success");
    } catch {
      setMicStatus("error");
    }
  };

  const testSpeaker = () => {
    setSpeakerStatus("playing");
    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;

    const audioCtx = new AudioContextConstructor();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
    
    setTimeout(() => setSpeakerStatus("success"), 1000);
  };
  

  const handleStartInterview = () => {
    router.push("/protected/interview/gemini");
  };

  const isSetupComplete = micStatus === "success" && speakerStatus === "success";

  return (
    <div className="flex-1 w-full flex flex-col items-center pt-10 pb-20 px-4 md:px-8">
      <div className="w-full max-w-[1150px] flex justify-between items-center mb-8">
        <h1 className="text-xl font-semibold">Candidate interview</h1>
      </div>

      <Card className="w-full max-w-[1150px] shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Check your setup</CardTitle>
          <CardDescription className="text-center">
            Make sure your devices are working before starting.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-8 lg:gap-12">
            <div className="flex-1 flex flex-col gap-6">
              
              {/* Mic Test */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className={`flex-1 border rounded-md p-4 text-sm flex items-center justify-between ${micStatus === 'success' ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <span className="font-medium text-base">Microphone</span>
                  {micStatus === 'success' && <CheckCircle2 className="w-5 h-5" />}
                </div>
                <Button onClick={testMicrophone} variant="outline" className="w-full sm:w-36 h-12">
                  {micStatus === "testing" ? "Testing..." : "Test mic"}
                </Button>
              </div>

              {/* Speaker Test */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className={`flex-1 border rounded-md p-4 text-sm flex items-center justify-between ${speakerStatus === 'success' ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <span className="font-medium text-base">Speaker</span>
                  {speakerStatus === 'success' && <CheckCircle2 className="w-5 h-5" />}
                </div>
                <Button onClick={testSpeaker} variant="outline" className="w-full sm:w-36 h-12">
                  {speakerStatus === "playing" ? "Playing..." : "Play sound"}
                </Button>
              </div>

              {/* Read Aloud */}
              <div className="border border-dashed rounded-md p-4 text-center text-sm text-muted-foreground mt-2 bg-muted/20">
                Read aloud: <span className="font-medium text-foreground">&quot;The quick brown fox jumps over the lazy dog.&quot;</span>
              </div>
            </div>

             {/* Right Column (Status & Restart) */}
            <div className="flex-1 flex flex-col gap-6">
              {micStatus === "error" ? (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive p-5 rounded-md text-sm flex gap-3 h-full items-center">
                  <AlertCircle className="w-6 h-6 shrink-0" />
                  <p className="leading-relaxed">Mic blocked: click the lock icon in the address bar and set Microphone to Allow, then refresh the page.</p>
                </div>
              ) : (
                <div className="bg-muted/50 border p-6 rounded-md text-sm text-muted-foreground flex flex-col items-center justify-center h-full min-h-[120px] text-center gap-2">
                  
                  {micStatus === "idle" && (
                    <>
                      <p className="font-semibold text-foreground text-base">Device Status: Idle</p>
                      <p>Click the <strong>&quot;Test mic&quot;</strong> or <strong>&quot;Play sound&quot;</strong> buttons to check your devices.</p>
                    </>
                  )}

                  {micStatus === "testing" && (
                    <>
                      <p className="font-semibold text-primary text-base animate-pulse">Testing...</p>
                      <p>Please allow microphone access in your browser if prompted.</p>
                    </>
                  )}

                  {micStatus === "success" && (
                    <>
                      <div className="flex items-center gap-2 text-green-600 dark:text-green-500 font-semibold text-base mb-2">
                        <CheckCircle2 className="w-5 h-5" />
                        Microphone Ready
                      </div>
                      <p>Your microphone is working perfectly. You can now start the interview.</p>
                      <p className="text-xs mt-2">Tip: Wear headphones to avoid echo during the interview.</p>
                    </>
                  )}
                </div>
              )}
              
              <Button variant="outline" className="w-full h-12" onClick={() => { setMicStatus("idle"); setSpeakerStatus("idle"); }}>
                Restart devices
              </Button>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex flex-col items-center mt-12">
            <Button 
              onClick={handleStartInterview} 
              disabled={!isSetupComplete}
              className="w-full sm:w-80 text-base py-6"
            >
              Start Interview
            </Button>
            {!isSetupComplete && (
               <p className="text-sm text-destructive mt-3">
                 Fix: allow microphone and speaker access to start.
               </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}