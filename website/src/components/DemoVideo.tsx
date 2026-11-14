import type { ReactNode } from "react";

import useBaseUrl from "@docusaurus/useBaseUrl";

// A demo video with its poster and a one-line caption. The MP4 files are not in
// git: `npm run fetch-videos` downloads them from the `demo-videos` GitHub
// release into static/videos/ (the docs deploy workflow does this before the
// build). The posters are in static/images/videos/.
export default function DemoVideo({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const src = useBaseUrl(`/videos/${name}.mp4`);
  const poster = useBaseUrl(`/images/videos/${name}.jpg`);
  return (
    <figure className="demo-video">
      <video controls preload="none" poster={poster} src={src} />
      <figcaption>
        {children} · <a href={src}>Download MP4</a>
      </figcaption>
    </figure>
  );
}

export function DemoVideoRow({ children }: { children: ReactNode }) {
  return <div className="demo-video-row">{children}</div>;
}
