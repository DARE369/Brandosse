import React from "react";
import { Calendar, Clock, Trash2, Edit, Send, AlertCircle } from "lucide-react";
import { POST_STATUS } from "../../../constants/statuses";

export default function ModerationQueue({ groupedPosts = {}, onAction }) {
  
  if (!groupedPosts || Object.keys(groupedPosts).length === 0) {
    return (
      <div className="admin-moderation-empty">
        <p>No content found.</p>
      </div>
    );
  }

  return (
    <div className="moderation-queue-stack">
      {Object.entries(groupedPosts).map(([date, posts]) => (
        <div key={date} className="queue-date-group">
          {/* Date Header */}
          <h3 className="queue-date-label">
            <Calendar size={12} className="admin-icon-accent" /> {date}
          </h3>
          
          {/* Table */}
          <div className="queue-table-container">
            <table className="queue-table">
              <thead>
                <tr>
                  <th scope="col" className="queue-col-media">Media</th>
                  <th scope="col" className="queue-col-user">User</th>
                  <th scope="col">Caption / Details</th>
                  <th scope="col" className="queue-col-status">Status</th>
                  <th scope="col" className="queue-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => {
                  // 1. Use the NORMALIZED fields from AdminModerationPage
                  // Fallback to storage_path if media_url is missing
                  const mediaUrl = post.media_url || post.storage_path;
                  
                  // Check if video based on normalized type OR file extension
                  const isVideo = post.media_type === 'video' || (mediaUrl && mediaUrl.match(/\.(mp4|mov|webm)$/i));
                  
                  // Caption fallback
                  const displayCaption = post.caption || post.prompt || "No caption";

                  return (
                    <tr key={post.id}>
                      {/* Media Preview */}
                      <td className="queue-cell-media" data-label="Media">
                        <div className="table-media-preview">
                          {mediaUrl ? (
                            isVideo ? (
                              <video src={mediaUrl} muted className="queue-media-fill" />
                            ) : (
                              <img src={mediaUrl} alt="Preview" className="queue-media-fill" />
                            )
                          ) : (
                            <div className="queue-media-placeholder">
                              <AlertCircle size={16} />
                            </div>
                          )}
                        </div>
                      </td>

                      {/* User Info */}
                      <td className="queue-cell" data-label="User">
                        <div className="queue-user-name">
                          {post.profiles?.full_name || "Unknown User"}
                        </div>
                        <div className="queue-user-email">
                          {post.profiles?.email}
                        </div>
                      </td>

                      {/* Content Details */}
                      <td className="queue-cell" data-label="Caption / Details">
                        <div className="queue-caption" title={displayCaption}>
                          {displayCaption}
                        </div>
                        {post.unified_status === POST_STATUS.SCHEDULED && (
                          <div className="queue-scheduled-time">
                            <Clock size={10} /> 
                            {new Date(post.unified_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="queue-cell" data-label="Status">
                        <span className={`status-badge status-${post.unified_status}`}>
                          {post.unified_status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="queue-cell-actions" data-label="Actions">
                        <div className="row-actions">
                          {/* Schedule Button (Only for Drafts) */}
                          {post.unified_status === POST_STATUS.DRAFT && (
                            <button 
                              onClick={() => onAction('schedule', post)} 
                              className="btn-action-sm schedule" 
                              title="Schedule Post"
                              type="button"
                            >
                              <Send size={14} />
                            </button>
                          )}
                          
                          {/* Edit Button (Drafts & Scheduled) */}
                          {post.unified_status !== POST_STATUS.PUBLISHED && (
                            <button 
                              onClick={() => onAction('edit', post)} 
                              className="btn-action-sm" 
                              title="Edit Content"
                              type="button"
                            >
                              <Edit size={14} />
                            </button>
                          )}
                          
                          {/* Delete Button (Always) */}
                          <button 
                            onClick={() => onAction('delete', post)} 
                            className="btn-action-sm delete" 
                            title="Delete"
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
