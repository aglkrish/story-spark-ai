import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { isLoggedIn, getUserInfo } from '../services/auth.service';
import { USER_ROLE } from '../constants/role';

interface ProtectedRouteProps {
  allowedRoles?: USER_ROLE[];
  children?: React.ReactNode;
}

/**
 * ProtectedRoute Component
 * Guards a route by verifying the stored token is present, decodable,
 * not past its `exp` claim, and that the user's role is authorized if allowedRoles is specified.
 * Redirects to /login if token checks fail, or / if unauthorized.
 */
const ProtectedRoute = ({ allowedRoles, children }: ProtectedRouteProps) => {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles) {
    const user = getUserInfo();
    const userRole = user?.role as USER_ROLE;
    if (!userRole || !allowedRoles.includes(userRole)) {
      return <Navigate to="/" replace />;
    }
  }

  return children ? <>{children}</> : <Outlet />;
};

export default ProtectedRoute;
