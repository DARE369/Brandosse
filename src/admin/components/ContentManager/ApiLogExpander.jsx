// src/components/ContentManager/ApiLogExpander.jsx
import React, { useState, useEffect } from "react";
export default function ApiLogExpander({ logId, fetchLog }) {
  const [logData, setLogData] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && logId) {
      fetchLog(logId).then((data) => setLogData(data));
    }
  }, [expanded, logId, fetchLog]);

  return (
    <div className="api-log-expander">
      <button onClick={() => setExpanded(!expanded)}>
        {expanded ? "Hide Logs" : "View Logs"}
      </button>
      {expanded && logData && (
        <pre>{JSON.stringify(logData, null, 2)}</pre>
      )}
    </div>
  );
}
