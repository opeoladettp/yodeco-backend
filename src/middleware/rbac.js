/**
 * Role-based access control middleware
 * Provides authorization based on user roles and permissions
 */

// Define role hierarchy and permissions
const ROLES = {
  USER: 'User',
  PANELIST: 'Panelist', 
  SYSTEM_ADMIN: 'System_Admin'
};

// Define role hierarchy (higher roles inherit lower role permissions)
const ROLE_HIERARCHY = {
  [ROLES.USER]: 0,
  [ROLES.PANELIST]: 1,
  [ROLES.SYSTEM_ADMIN]: 2
};

// Define permissions for each role
const ROLE_PERMISSIONS = {
  [ROLES.USER]: [
    'vote:create',
    'vote:read_own',
    'content:read',
    'nomination:create', // New permission for public nominations
    'nomination:read_own',
    'profile:read_own',
    'profile:update_own'
  ],
  [ROLES.PANELIST]: [
    'vote:create',
    'vote:read_own',
    'vote:read_counts',
    'content:read',
    'content:create',
    'content:update',
    'content:delete',
    'nomination:create',
    'nomination:read_own',
    'nomination:read_all',
    'nomination:approve', // New permission to approve public nominations
    'nomination:reject',
    'media:upload',
    'profile:read_own',
    'profile:update_own'
  ],
  [ROLES.SYSTEM_ADMIN]: [
    'vote:create',
    'vote:read_own',
    'vote:read_all',
    'vote:read_counts',
    'content:read',
    'content:create',
    'content:update',
    'content:delete',
    'nomination:create',
    'nomination:read_own',
    'nomination:read_all',
    'nomination:approve',
    'nomination:reject',
    'media:upload',
    'user:read_all',
    'user:update_role',
    'user:promote',
    'system:admin',
    'system:monitor',
    'audit:read',
    'audit:export',
    'audit:verify',
    'profile:read_own',
    'profile:update_own',
    'profile:read_all'
  ]
};

/**
 * Get all permissions for a role (including inherited permissions)
 * @param {string} role - User role
 * @returns {string[]} Array of permissions
 */
function getRolePermissions(role) {
  const permissions = new Set();
  const roleLevel = ROLE_HIERARCHY[role];
  
  if (roleLevel === undefined) {
    return [];
  }
  
  // Add permissions from current role and all lower roles
  Object.entries(ROLE_HIERARCHY).forEach(([roleName, level]) => {
    if (level <= roleLevel) {
      const rolePerms = ROLE_PERMISSIONS[roleName] || [];
      rolePerms.forEach(perm => permissions.add(perm));
    }
  });
  
  return Array.from(permissions);
}

/**
 * Check if user has required permission
 * @param {string} userRole - User's role
 * @param {string} requiredPermission - Required permission
 * @returns {boolean} True if user has permission
 */
function hasPermission(userRole, requiredPermission) {
  const userPermissions = getRolePermissions(userRole);
  return userPermissions.includes(requiredPermission);
}

/**
 * Check if user has minimum required role
 * @param {string} userRole - User's role
 * @param {string} requiredRole - Minimum required role
 * @returns {boolean} True if user has sufficient role
 */
function hasMinimumRole(userRole, requiredRole) {
  const userLevel = ROLE_HIERARCHY[userRole];
  const requiredLevel = ROLE_HIERARCHY[requiredRole];
  
  return userLevel !== undefined && requiredLevel !== undefined && userLevel >= requiredLevel;
}

/**
 * Middleware factory to require specific permission
 * @param {string} permission - Required permission
 * @returns {Function} Express middleware function
 */
function requirePermission(permission) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource',
          retryable: false
        }
      });
    }
    
    // Check if user has required permission
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Permission '${permission}' is required to access this resource`,
          details: {
            userRole: req.user.role,
            requiredPermission: permission,
            userPermissions: getRolePermissions(req.user.role)
          },
          retryable: false
        }
      });
    }
    
    next();
  };
}

/**
 * Middleware factory to require minimum role
 * @param {string} role - Minimum required role
 * @returns {Function} Express middleware function
 */
function requireRole(role) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource',
          retryable: false
        }
      });
    }
    
    // Check if user has minimum required role
    if (!hasMinimumRole(req.user.role, role)) {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: `Role '${role}' or higher is required to access this resource`,
          details: {
            userRole: req.user.role,
            requiredRole: role,
            roleHierarchy: ROLE_HIERARCHY
          },
          retryable: false
        }
      });
    }
    
    next();
  };
}

/**
 * Middleware factory to require multiple permissions (AND logic)
 * @param {string[]} permissions - Array of required permissions
 * @returns {Function} Express middleware function
 */
function requireAllPermissions(permissions) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource',
          retryable: false
        }
      });
    }
    
    // Check if user has all required permissions
    const missingPermissions = permissions.filter(perm => !hasPermission(req.user.role, perm));
    
    if (missingPermissions.length > 0) {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Multiple permissions are required to access this resource',
          details: {
            userRole: req.user.role,
            requiredPermissions: permissions,
            missingPermissions: missingPermissions,
            userPermissions: getRolePermissions(req.user.role)
          },
          retryable: false
        }
      });
    }
    
    next();
  };
}

/**
 * Middleware factory to require any of the specified permissions (OR logic)
 * @param {string[]} permissions - Array of permissions (user needs at least one)
 * @returns {Function} Express middleware function
 */
function requireAnyPermission(permissions) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource',
          retryable: false
        }
      });
    }
    
    // Check if user has any of the required permissions
    const hasAnyPermission = permissions.some(perm => hasPermission(req.user.role, perm));
    
    if (!hasAnyPermission) {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `One of the following permissions is required: ${permissions.join(', ')}`,
          details: {
            userRole: req.user.role,
            requiredPermissions: permissions,
            userPermissions: getRolePermissions(req.user.role)
          },
          retryable: false
        }
      });
    }
    
    next();
  };
}

/**
 * Middleware factory to require any of the specified roles (OR logic)
 * @param {string[]} roles - Array of roles (user needs at least one)
 * @returns {Function} Express middleware function
 */
function requireAnyRole(roles) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource',
          retryable: false
        }
      });
    }
    
    // Check if user has any of the required roles
    const hasAnyRole = roles.some(role => hasMinimumRole(req.user.role, role));
    
    if (!hasAnyRole) {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: `One of the following roles is required: ${roles.join(', ')}`,
          details: {
            userRole: req.user.role,
            requiredRoles: roles,
            roleHierarchy: ROLE_HIERARCHY
          },
          retryable: false
        }
      });
    }
    
    next();
  };
}

/**
 * Middleware to check resource ownership
 * Allows access if user owns the resource or has admin privileges
 * @param {string} resourceUserIdField - Field name containing the resource owner's ID
 * @returns {Function} Express middleware function
 */
function requireOwnershipOrAdmin(resourceUserIdField = 'userId') {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource',
          retryable: false
        }
      });
    }
    
    // System admins can access any resource
    if (req.user.role === ROLES.SYSTEM_ADMIN) {
      return next();
    }
    
    // Check if user owns the resource
    const resourceUserId = req.params[resourceUserIdField] || req.body[resourceUserIdField] || req.query[resourceUserIdField];
    
    if (!resourceUserId) {
      return res.status(400).json({
        error: {
          code: 'MISSING_RESOURCE_OWNER',
          message: `Resource owner ID (${resourceUserIdField}) is required`,
          retryable: false
        }
      });
    }
    
    if (req.user._id.toString() !== resourceUserId.toString()) {
      return res.status(403).json({
        error: {
          code: 'RESOURCE_ACCESS_DENIED',
          message: 'You can only access your own resources',
          retryable: false
        }
      });
    }
    
    next();
  };
}

module.exports = {
  ROLES,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  getRolePermissions,
  hasPermission,
  hasMinimumRole,
  requirePermission,
  requireRole,
  requireAllPermissions,
  requireAnyPermission,
  requireAnyRole,
  requireOwnershipOrAdmin
};