#define _GNU_SOURCE
#define NAPI_VERSION 8
#include <node_api.h>
#include <sys/file.h>
#include <sys/syscall.h>
#include <sys/xattr.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <string.h>
#include <math.h>

/* Deliberately small Linux-only boundary. No paths are opened, no commands run,
 * no xattr values read, and no user-selected flags are accepted. */
static napi_value error(napi_env env, const char *code) {
  napi_throw_error(env, code, code);
  return NULL;
}
static napi_value os_error(napi_env env) {
  const char *code = "EIO";
  switch (errno) {
    case EEXIST: code = "EEXIST"; break;
    case ENOTEMPTY: code = "ENOTEMPTY"; break;
    case EACCES: code = "EACCES"; break;
    case EPERM: code = "EPERM"; break;
    case EROFS: code = "EROFS"; break;
    case ENOENT: code = "ENOENT"; break;
    case ENOTDIR: code = "ENOTDIR"; break;
    case EXDEV: code = "EXDEV"; break;
    case EINVAL: code = "EINVAL"; break;
    case ENOSYS: code = "ENOSYS"; break;
    case EBADF: code = "EBADF"; break;
    case EOPNOTSUPP: code = "EOPNOTSUPP"; break;
  }
  return error(env, code);
}
static int fd_arg(napi_env env, napi_value value, int *fd) {
  double number;
  if (napi_get_value_double(env, value, &number) != napi_ok ||
      !isfinite(number) || number < 0 || number > INT_MAX || floor(number) != number) return 0;
  *fd = (int)number;
  return 1;
}
static int name_arg(napi_env env, napi_value value, char name[256]) {
  size_t length = 0, written = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok || !length || length > 255) return 0;
  if (napi_get_value_string_utf8(env, value, name, 256, &written) != napi_ok || written != length) return 0;
  return strlen(name) == length && !strchr(name, '/') && strcmp(name, ".") && strcmp(name, "..");
}
static napi_value empty_metadata(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value args[1], result; int fd;
  if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 1 || !fd_arg(env, args[0], &fd)) return error(env, "EINVAL");
  /* Size-only probes may overestimate (notably overlay filesystems). Inspect
   * the bounded name list, never any attribute value. */
  char names[65536];
  ssize_t size = flistxattr(fd, names, sizeof(names));
  if (size < 0 && errno != EOPNOTSUPP) return os_error(env);
  if (napi_get_boolean(env, size == 0 || size < 0, &result) != napi_ok) return error(env, "EINVAL");
  return result;
}
static napi_value try_lock(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value args[1], result; int fd;
  if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 1 || !fd_arg(env, args[0], &fd)) return error(env, "EINVAL");
  int ok = flock(fd, LOCK_EX | LOCK_NB);
  if (ok < 0 && errno != EWOULDBLOCK) return os_error(env);
  if (napi_get_boolean(env, ok == 0, &result) != napi_ok) return error(env, "EINVAL");
  return result;
}
static napi_value no_replace(napi_env env, napi_callback_info info) {
  size_t count = 4; napi_value args[4], result; int from, to; char source[256], target[256];
  if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 4 ||
      !fd_arg(env, args[0], &from) || !name_arg(env, args[1], source) ||
      !fd_arg(env, args[2], &to) || !name_arg(env, args[3], target)) return error(env, "EINVAL");
  /* RENAME_NOREPLACE = 1. Fail closed on unsupported kernels/filesystems. */
  if (syscall(SYS_renameat2, from, source, to, target, 1U) < 0) return os_error(env);
  if (napi_get_undefined(env, &result) != napi_ok) return error(env, "EINVAL");
  return result;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "emptyMetadata", NULL, empty_metadata, NULL, NULL, NULL, napi_default, NULL },
    { "tryLock", NULL, try_lock, NULL, NULL, NULL, napi_default, NULL },
    { "renameNoReplace", NULL, no_replace, NULL, NULL, NULL, napi_default, NULL }
  };
  if (napi_define_properties(env, exports, 3, properties) != napi_ok) return error(env, "EINVAL");
  return exports;
}
NAPI_MODULE(workspace_boundary, init)
