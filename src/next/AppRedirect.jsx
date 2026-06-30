"use client";

import React from "react";
import { useAppNavigation } from "../Context/AppNavigationContext";

export default function AppRedirect({ to, replace = false, state = null }) {
  const { navigate } = useAppNavigation();

  React.useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, replace, state, to]);

  return null;
}
