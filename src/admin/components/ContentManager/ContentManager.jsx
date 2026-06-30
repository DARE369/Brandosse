import React, { useState, useEffect } from "react";
import ContentDataGrid from "./ContentDataGrid";
import MetadataEditDrawer from "./MetadataEditDrawer";
import toast from "react-hot-toast";
import { Search } from "lucide-react"; // Ensure lucide-react is installed
import { supabase } from "../../../services/supabaseClient";
export default function ContentManager({ user }) {
  const [filters, setFilters] = useState({ search: "", status: "all" });
  const [posts, setPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const confirmAction = (message, actionLabel, onConfirm) => {
    toast((toastInstance) => (
      <div className="admin-toast-confirm">
        <p>{message}</p>
        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-secondary-button"
            onClick={() => toast.dismiss(toastInstance.id)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-primary-button"
            onClick={async () => {
              toast.dismiss(toastInstance.id);
              await onConfirm();
            }}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    ), { duration: 10000 });
  };

  // 1. Initial Fetch & Subscription
  useEffect(() => {
    fetchContent();

    // Real-time: Refresh when 'generations' table changes
    const channel = supabase
      .channel('content-manager-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'generations' }, () => {
        fetchContent();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, filters]);

  // 2. Fetch Logic (Manual Join for Profiles)
  const fetchContent = async () => {
    setLoading(true);
    try {
      // A. Get Generations
      let query = supabase
        .from("generations")
        .select("*")
        .order("created_at", { ascending: false });

      if (user?.id) query = query.eq("user_id", user.id);
      if (filters.search) query = query.ilike("prompt", `%${filters.search}%`);
      if (filters.status && filters.status !== 'all') query = query.eq("status", filters.status);

      const { data: genData, error: genError } = await query;
      if (genError) throw genError;

      // B. Get Profiles (Manual Join)
      const userIds = [...new Set(genData.map(g => g.user_id).filter(Boolean))];
      let profilesMap = {};
      
      if (userIds.length > 0) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", userIds);
        
        if (profileData) {
          profileData.forEach(p => { profilesMap[p.id] = p; });
        }
      }

      // C. Map Data
      const mappedPosts = genData.map((g) => {
        const profile = profilesMap[g.user_id] || {};
        return {
          id: g.id,
          user_email: profile.email || "Unknown",
          user_name: profile.full_name || "User",
          snippet: g.prompt,
          media_url: g.storage_path,
          media_type: g.media_type,
          status: g.status,
          created_at: g.created_at,
          caption: g.metadata?.caption || "", 
          hashtags: g.metadata?.hashtags || []
        };
      });

      setPosts(mappedPosts);
    } catch (err) {
      console.error("Error fetching content:", err);
    } finally {
      setLoading(false);
    }
  };

  // 3. Action Handlers
  const handleEdit = (post) => {
    setSelectedPost(post);
    setDrawerVisible(true);
  };

  const handleRegenerate = async (post) => {
    confirmAction("Regenerate this media?", "Regenerate", async () => {
      toast.success(`Regeneration triggered for ID: ${post.id}`);
    });
  };

  const handleSaveUpdate = async (updatedData) => {
    try {
      const { error } = await supabase
        .from("generations")
        .update({
          prompt: updatedData.snippet,
          storage_path: updatedData.media_url,
          metadata: { caption: updatedData.caption, hashtags: updatedData.hashtags }
        })
        .eq("id", updatedData.id);

      if (error) throw error;
      setPosts(prev => prev.map(p => p.id === updatedData.id ? { ...p, ...updatedData } : p));
      setDrawerVisible(false);
    } catch (err) {
      toast.error("Update failed: " + err.message);
    }
  };

  return (
    <div className="content-manager">
{/* Custom Filter Bar */}
<div className="content-filter-bar">
  {/* Search Group */}
  <div className="filter-input-group">
    <Search className="search-icon-absolute" size={18} />
    <input 
      type="text" 
      placeholder="Search content prompt..." 
      className="filter-input"
      value={filters.search}
      onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
    />
  </div>
        
{/* Status Select */}
  <select 
    className="filter-select"
    value={filters.status}
    onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
  >
    <option value="all">All Status</option>
    <option value="completed">Completed</option>
    <option value="processing">Processing</option>
    <option value="failed">Failed</option>
  </select>
</div>

      {/* Grid Area */}
      <div className="content-area">
        {loading && posts.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">Loading content...</div>
        ) : (
          <ContentDataGrid 
            posts={posts} 
            onEdit={handleEdit} 
            onRegenerate={handleRegenerate} 
          />
        )}
      </div>

      {/* Edit Drawer */}
      {drawerVisible && selectedPost && (
        <MetadataEditDrawer
          post={selectedPost}
          visible={drawerVisible}
          onClose={() => setDrawerVisible(false)}
          onSave={handleSaveUpdate}
        />
      )}
    </div>
  );
}
