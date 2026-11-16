export function PromotionalVideo() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-xl my-6">
      <h3 className="text-lg font-semibold text-white mb-3">
        See TradeQuote PRO in Action
      </h3>
      <p className="text-sm text-gray-400 mb-4">
        Build lightning-fast estimates, manage your pipeline, and win more bids.
      </p>
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        <video 
          controls 
          autoPlay 
          muted 
          loop 
          className="h-full w-full object-cover"
        >
          <source src="http://googleusercontent.com/generated_video_content/11455453699240107338" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  );
}
