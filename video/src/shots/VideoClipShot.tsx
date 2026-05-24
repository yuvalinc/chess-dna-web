import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import type { VideoClipShot as VideoClipShotProps } from "../storyboard/types";

export const VideoClipShot: React.FC<VideoClipShotProps> = ({
  src,
  muted = true,
  fit = "cover",
  background = "#000",
}) => {
  const resolved = src.startsWith("http") ? src : staticFile(src);
  return (
    <AbsoluteFill style={{ background, justifyContent: "center", alignItems: "center" }}>
      <OffthreadVideo
        src={resolved}
        muted={muted}
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
        }}
      />
    </AbsoluteFill>
  );
};
