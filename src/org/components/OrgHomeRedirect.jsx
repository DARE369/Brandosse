"use client";

import React from 'react';
import AppRedirect from '@/next/AppRedirect';
import useOrgContext from '../hooks/useOrgContext';
import { getOrganizationHomePath } from '../utils/orgHomePath';

export default function OrgHomeRedirect() {
  const { organizationId, role } = useOrgContext();
  return <AppRedirect to={getOrganizationHomePath(organizationId, role)} replace />;
}
