import { Series, useVideoConfig, Audio, staticFile } from "remotion";
import { HookShot } from "../shots/HookShot";
import { TitleShot } from "../shots/TitleShot";
import { SpotlightShot } from "../shots/SpotlightShot";
import { KenBurnsShot } from "../shots/KenBurnsShot";
import { PunchlineShot } from "../shots/PunchlineShot";
import { MoveSequenceShot } from "../shots/MoveSequenceShot";
import { VsTitleShot } from "../shots/VsTitleShot";
import { OutroShot } from "../shots/OutroShot";
import { VideoClipShot } from "../shots/VideoClipShot";
import { StreakShot } from "../shots/StreakShot";
import type { Storyboard } from "../storyboard/types";

export type BrilliantReelProps = {
  storyboard: Storyboard;
  audioSrc?: string;
  audioVolume?: number;
  // Offset into the source audio (seconds) — useful when the song's drop is
  // partway through, e.g. drop a song's beat-1 onto the first video frame by
  // setting this to the seconds-from-source-start where that beat lives.
  audioStartFromSec?: number;
};

export const BrilliantReel: React.FC<BrilliantReelProps> = ({
  storyboard,
  audioSrc,
  audioVolume = 1,
  audioStartFromSec = 0,
}) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {audioSrc && (
        <Audio
          src={staticFile(audioSrc)}
          volume={audioVolume}
          startFrom={Math.round(audioStartFromSec * fps)}
        />
      )}
      <Series>
        {storyboard.shots.map((shot, i) => {
          const frames = Math.round(shot.durationSec * fps);
          let element: React.ReactNode;
          switch (shot.type) {
            case "hook":
              element = <HookShot {...shot} />;
              break;
            case "title":
              element = <TitleShot {...shot} />;
              break;
            case "spotlight":
              element = <SpotlightShot {...shot} />;
              break;
            case "kenburns":
              element = <KenBurnsShot {...shot} />;
              break;
            case "punchline":
              element = <PunchlineShot {...shot} />;
              break;
            case "moveSequence":
              element = <MoveSequenceShot {...shot} />;
              break;
            case "vsTitle":
              element = <VsTitleShot {...shot} />;
              break;
            case "outro":
              element = <OutroShot {...shot} />;
              break;
            case "videoClip":
              element = <VideoClipShot {...shot} />;
              break;
            case "streak":
              element = <StreakShot {...shot} />;
              break;
          }
          return (
            <Series.Sequence key={i} durationInFrames={frames}>
              {element}
            </Series.Sequence>
          );
        })}
      </Series>
    </>
  );
};

export function totalFrames(storyboard: Storyboard, fps: number): number {
  return storyboard.shots.reduce((sum, s) => sum + Math.round(s.durationSec * fps), 0);
}
