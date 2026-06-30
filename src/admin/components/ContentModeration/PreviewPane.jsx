import React, { useState, useRef } from "react";
import { Play, Pause, ChevronLeft, ChevronRight } from "lucide-react";
const PLATFORM_STYLES = {
  Instagram: { aspectRatio: "1 / 1", borderColor: "#E1306C", name: "Instagram" },
  TikTok: { aspectRatio: "9 / 16", borderColor: "#69C9D0", name: "TikTok" },
  YouTube: { aspectRatio: "16 / 9", borderColor: "#FF0000", name: "YouTube" },
  Facebook: { aspectRatio: "4 / 5", borderColor: "#1877F2", name: "Facebook" },
};

export default function PreviewPane({ post }) {
  const [selectedPlatforms, setSelectedPlatforms] = useState(["Instagram"]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef(null);

  const mediaItems = Array.isArray(post.mediaUrl) ? post.mediaUrl : [post.mediaUrl];

  const togglePlatform = (platform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  };

  const handleVideoHover = (play) => {
    if (videoRef.current) {
      if (play) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const handleVideoClick = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const nextItem = () =>
    setCurrentIndex((prev) => (prev + 1) % mediaItems.length);
  const prevItem = () =>
    setCurrentIndex((prev) => (prev - 1 + mediaItems.length) % mediaItems.length);

  return (
    <div className="preview-pane">
      <h3>Post Preview</h3>

      {/* Platform Selector */}
      <div className="platform-selector">
        {Object.keys(PLATFORM_STYLES).map((platform) => (
          <button
            key={platform}
            className={`platform-btn ${
              selectedPlatforms.includes(platform) ? "active" : ""
            }`}
            onClick={() => togglePlatform(platform)}
          >
            {platform}
          </button>
        ))}
      </div>

      {/* Scrollable Previews */}
      <div className="preview-scroll-container">
        <div className="preview-grid">
          {selectedPlatforms.map((platform) => {
            const { aspectRatio, borderColor, name } = PLATFORM_STYLES[platform];
            const media = mediaItems[currentIndex];
            const isVideo = media?.match(/\.(mp4|mov|webm)$/i);

            return (
              <div
                key={platform}
                className="platform-preview"
                style={{ aspectRatio, borderColor }}
              >
                {isVideo ? (
                  <video
                    ref={videoRef}
                    src={media}
                    className="preview-media"
                    muted
                    onMouseEnter={() => handleVideoHover(true)}
                    onMouseLeave={() => handleVideoHover(false)}
                    onClick={handleVideoClick}
                  />
                ) : (
                  <img src={media} alt="preview" className="preview-media" />
                )}

                {/* Carousel Controls */}
                {mediaItems.length > 1 && (
                  <>
                    <button className="nav-btn left" onClick={prevItem}>
                      <ChevronLeft size={18} />
                    </button>
                    <button className="nav-btn right" onClick={nextItem}>
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}

                {/* Platform Label */}
                <div className="platform-label">{name}</div>

                {/* Caption */}
                <div className="caption-box">
                  <p className="caption">{post.caption}</p>
                  <p className="hashtags">{post.hashtags}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
