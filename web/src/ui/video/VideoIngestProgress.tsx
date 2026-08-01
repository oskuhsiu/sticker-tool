export interface VideoIngestProgressValue {
  sourceFrames: number;
  totalSourceFrames: number;
  crops: number;
  totalCrops: number;
  chunks: number;
}
export function VideoIngestProgress(props: {
  value: VideoIngestProgressValue;
  onCancel: () => void;
}) {
  const progress = props.value.totalCrops > 0 ? props.value.crops / props.value.totalCrops : 0;
  return (
    <div className="video-ingest-progress" role="status" aria-live="polite">
      <strong>建立未去背 raw master</strong>
      <div>來源 frame {props.value.sourceFrames}/{props.value.totalSourceFrames} · crop {props.value.crops}/{props.value.totalCrops} · chunk {props.value.chunks}</div>
      <progress max={1} value={progress} />
      <button className="btn small" onClick={props.onCancel}>取消</button>
    </div>
  );
}
