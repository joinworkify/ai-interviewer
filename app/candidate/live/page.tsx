import { LiveInterview } from "@/components/candidate/live-interview";
import { readDograhWidgetConfig } from "@/lib/dograh/config";

/**
 * Live interview. The Dograh widget URL is read here, on the server, so the
 * client component never imports the server-side Dograh config. When Dograh is
 * not set up, the screen falls back to the scripted fake interviewer.
 */
export default function LivePage() {
  const widget = readDograhWidgetConfig(process.env);
  return <LiveInterview widgetSrc={widget.ok ? widget.src : null} />;
}
