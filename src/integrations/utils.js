import $script from 'scriptjs';

export function dynamicImport(dependency) {
    return new Promise((resolve) => {
        $script(dependency, resolve);
    });
}
