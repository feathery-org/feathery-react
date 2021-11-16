import $script from 'scriptjs';

export function dynamicImport(dependency, async = true, index = 0) {
  if (async) {
    return new Promise((resolve) => {
      $script(dependency, resolve);
    });
  } else if (index < dependency.length) {
    return new Promise((resolve) => {
      $script(dependency[index], resolve);
    }).then(() => dynamicImport(dependency, false, index + 1));
  }
}
