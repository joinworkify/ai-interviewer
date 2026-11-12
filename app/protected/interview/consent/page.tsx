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
import { Checkbox } from "@/components/ui/checkbox";

export default function ConsentPage() {
  const [isAgreed, setIsAgreed] = useState(false);
  const router = useRouter();

  const handleContinue = () => {
    if (isAgreed) {
      router.push("/protected/interview/setup"); 
    }
  };

  return (
    <div className="flex-1 w-full flex flex-col items-center pt-10 pb-20 px-4 md:px-8">
      <div className="w-full max-w-[1150px] flex justify-between items-center mb-8">
        <h1 className="text-xl font-semibold">Candidate interview</h1>
      </div>

      <Card className="w-full max-w-[1150px] shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Before we start</CardTitle>
          <CardDescription className="text-center">
            Please read the instructions carefully before proceeding.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          
          {/* Instructions Box */}
          <div className="border rounded-md p-6 h-72 overflow-y-auto bg-muted/50 text-muted-foreground text-sm leading-relaxed">
            <p className="font-semibold text-foreground mb-3 text-base">Reviewed instructions:</p>
            <p>Welcome to the AI Interview. Please ensure you are in a quiet environment. The AI will ask you a series of questions based on your chosen role and technology stack. Your answers will be evaluated. This session will take approximately 15-30 minutes.</p>
            <p className="mt-4">Please make sure your microphone is working and you have a stable internet connection. You can take a moment to gather your thoughts before answering each question.</p>
            <p className="mt-4 text-xs">[Placeholder for actual instructions]</p>
          </div>

          {/* Consent Checkbox */}
          <div className="flex items-center space-x-3 p-2">
            <Checkbox 
              id="consent" 
              checked={isAgreed} 
              onCheckedChange={(checked) => setIsAgreed(checked as boolean)} 
            />
            <label htmlFor="consent" className="text-sm font-medium leading-snug peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
              I agree to the AI interview and voice recording
            </label>
          </div>

          {/* Action Button */}
          <div className="flex flex-col items-center mt-4">
            <Button 
              onClick={handleContinue} 
              disabled={!isAgreed}
              className="w-full sm:w-80 text-base py-6"
            >
              Continue
            </Button>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              No microphone or recording before consent. Continue is enabled only after the checkbox is ticked.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}