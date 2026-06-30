import React from "react";
export default function ContentDataGrid({ posts = [], onEdit, onRegenerate }) {
  
  if (!posts || posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500 text-sm">
        <p>No content found.</p>
      </div>
    );
  }

  return (
    <div className="content-data-grid custom-scrollbar">
      <table>
        <thead>
          <tr>
            <th style={{ width: '80px' }}>Media</th>
            <th>User</th>
            <th>Prompt / Caption</th>
            <th>Status</th>
            <th>Created</th>
            <th style={{ width: '140px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id}>
              {/* Media Preview */}
              <td>
                <div className="media-preview">
                  {post.media_type === 'video' ? (
                    <video src={post.media_url} muted />
                  ) : (
                    <img src={post.media_url} alt="gen" />
                  )}
                </div>
              </td>

              {/* User Info */}
              <td>
                <div className="font-medium text-white">{post.user_name}</div>
                <div className="text-xs text-gray-500">{post.user_email}</div>
              </td>

              {/* Content */}
              <td>
                <div className="max-w-xs">
                  <div className="text-sm text-white truncate" title={post.snippet}>
                    <span className="text-indigo-400 font-medium">Prompt:</span> {post.snippet}
                  </div>
                  {post.caption && (
                    <div className="text-xs text-gray-500 italic truncate mt-1">
                      "{post.caption}"
                    </div>
                  )}
                </div>
              </td>

              {/* Status Badge (Inline for simplicity) */}
              <td>
                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider 
                  ${post.status === 'completed' ? 'bg-green-900/20 text-green-400 border border-green-900/30' : 
                    post.status === 'processing' ? 'bg-blue-900/20 text-blue-400 border border-blue-900/30' : 
                    'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                  {post.status}
                </span>
              </td>

              {/* Date */}
              <td className="text-gray-400">
                {new Date(post.created_at).toLocaleDateString()}
              </td>

              {/* Actions */}
              <td>
                <div className="flex gap-2">
                  <button 
                    onClick={() => onEdit(post)}
                    className="admin-action-btn edit"
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => onRegenerate(post)}
                    className="admin-action-btn regen"
                  >
                    Regen
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}