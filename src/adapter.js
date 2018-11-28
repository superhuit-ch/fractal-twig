'use strict';

const Fractal = require('@frctl/fractal');
const _ = require('lodash');
const Path = require('path');
const utils = Fractal.utils;

class TwigAdapter extends Fractal.Adapter {

    constructor(Twig, source, app, config) {

        super(Twig, source);
        this._app = app;
        this._config = config;

        let self = this;

        Twig.extend(function(Twig) {

            /*
             * Register a Fractal template loader. Locations can be handles or paths.
             */

            Twig.Templates.registerLoader('fractal', function(location, params, callback, errorCallback) {

                let parser = Twig.Templates.parsers['twig'];

                if (params.precompiled) {
                    params.data = params.precompiled;
                } else {
                    /**
                     * Make sure your path in `include` starts with / if you want to fix the path.
                     * For instance, make sure you include "/atoms/button/button.twig" with the leading forward slash,
                     * (and not just atoms/button/button.twig) if you're not at the root level.
                     */
                    var componentPath = location.startsWith("/") ? self.fixIncludePath(location) : Path.join(source.fullPath, location);
                    let view = isHandle(location) ? self.getView(location) : _.find(self.views, {path: componentPath});

                    if (!view) {
                        throw new Error(`Template ${location} not found; make sure you add a leading forward slash to your path if you're trying to include a component -> include /atoms/button/button.twig for instance`);
                    }
                    params.data = view.content;
                }

                return new Twig.Template(params);
            });

            /*
             * Monkey patch the render method to make sure that the _self variable
             * always refers to the actual component/sub-component being rendered.
             * Without this _self would always refer to the root component.
             */

            const render = Twig.Template.prototype.render;
            Twig.Template.prototype.render = function(context, params) {

                if (!self._config.pristine && this.id) {

                    let handle = null;

                    if (isHandle(this.id)) {
                        handle = this.id;
                    } else {
                        let view = _.find(self.views, {path: Path.join(source.fullPath, this.id)});
                        if (view) {
                            handle = view.handle;
                        }
                    }

                    if (handle) {
                        let prefixMatcher = new RegExp(`^\\${self._config.handlePrefix}`);
                        let entity = source.find(handle.replace(prefixMatcher, '@'));
                        if (entity) {
                            entity = entity.isVariant ? entity : entity.variants().default();
                            if (config.importContext) {
                                context = utils.defaultsDeep(_.cloneDeep(context), entity.getContext());
                                context._self = entity.toJSON();
                                setKeys(context);
                            }
                        }
                    }
                }

                /*
                 * Twig JS uses an internal _keys property on the context data
                 * which we need to regenerate every time we patch the context.
                 */

                function setKeys(obj) {

                    obj._keys = _.compact(_.map(obj, (val, key) => {
                        return (_.isString(key) && ! key.startsWith('_')) ? key : undefined;
                    }));
                    _.each(obj, (val, key) => {
                        if (_.isPlainObject(val) && (_.isString(key) && ! key.startsWith('_'))) {
                            setKeys(val);
                        }
                    });
                }

                return render.call(this, context, params);
            };

            /*
             * Twig caching is enabled for better perf, so we need to
             * manually update the cache when a template is updated or removed.
             */

            Twig.cache = false;

            self.on('view:updated', unCache);
            self.on('view:removed', unCache);
            self.on('wrapper:updated', unCache);
            self.on('wrapper:removed', unCache);

            function unCache(view) {
                let path = Path.relative(source.fullPath, _.isString(view) ? view : view.path);
                if (view.handle && Twig.Templates.registry[view.handle]) {
                    delete Twig.Templates.registry[view.handle];
                }
                if (Twig.Templates.registry[path]) {
                    delete Twig.Templates.registry[path];
                }
            }

        });

        function isHandle(str) {
            return str && str.startsWith(self._config.handlePrefix);
        }
    }

    get twig() {
        return this._engine;
    }

    render(path, str, context, meta) {

        let self = this;

        meta = meta || {};

        if (!this._config.pristine) {
            setEnv('_self', meta.self, context);
            setEnv('_target', meta.target, context);
            setEnv('_env', meta.env, context);
            setEnv('_config', this._app.config(), context);
        }

        return new Promise(function(resolve, reject){

            let tplPath = Path.relative(self._source.fullPath, path);

            try {
                let template = self.engine.twig({
                    method: 'fractal',
                    async: false,
                    rethrow: true,
                    name: meta.self ? `${self._config.handlePrefix}${meta.self.handle}` : tplPath,
                    precompiled: str
                });
                resolve(template.render(context));
            } catch (e) {
                reject(new Error(e));
            }

        });

        function setEnv(key, value, context) {
            if (context[key] === undefined && value !== undefined) {
                context[key] = value;
            }
        }
    }

    fixIncludePath (location) {
        /*
         * Calculate the relative path from the template directory to the actual template file.
         *
         * Twig uses a root directory and all includes are based upon that directory.
         * The following examples clarify why it's necessary to specify he root directory independently
         * from the template file that should be rendered.
         *
         * Including atoms/button.twig from index.twig at the root level would be fine when
         * rendering index.twig.
         *
         * Rendering atoms/button.twig from molecules/list.twig would break because the root
         * directory is molecules/list and Twig would try to incude molecules/list/atoms/button/button.twig,
         * resulting in a "Template not found error"
         *
         * 'location' is the inappropriate path that the engine is trying to reach, we will fix it.
         */
        var locationPathChunks = location.split('/'); // this will result for instance in ['organisms', 'menu', 'molecules', 'languages', 'languages.twig']
        var firstLevelFolderNames = ['atoms', 'molecules', 'organisms']; // TODO: get this from a config file

        // Start from the end of the locationPathChunks to find a match faster
        for (var i = locationPathChunks.length - 1; i >= 0; i--) {
            if ( firstLevelFolderNames.includes(locationPathChunks[i]) ) {
                // We found a match, so we will rebuild the appropriate path
                var newLocationChunks = locationPathChunks.slice(i, locationPathChunks.length); // will give for instance ['molecules', 'languages', 'languages.twig']
                var newLocation = Path.join(source.fullPath, newLocationChunks.join('/')); // source.fullPath looks like YOUR_HOME_FOLDER/theme/styleguide/components
                break; // exit loop at the first match we found
            }
        }
        return newLocation;
    }

}

module.exports = function(config) {

    config = _.defaults(config || {}, {
        pristine: false,
        handlePrefix: '@',
        importContext: false
    });

    return {

        register(source, app) {

            const Twig = require('twig');

            if (!config.pristine) {
                _.each(require('./functions')(app) || {}, function(func, name){
                    Twig.extendFunction(name, func);
                });
                _.each(require('./filters')(app), function(filter, name){
                    Twig.extendFilter(name, filter);
                });
                _.each(require('./tests')(app), function(test, name){
                    Twig.extendTest(name, test);
                });
                Twig.extend(function(Twig) {
                    _.each(require('./tags')(app), function(tag){
                        Twig.exports.extendTag(tag(Twig));
                    });
                });
            }

            _.each(config.functions || {}, function(func, name){
                Twig.extendFunction(name, func);
            });
            _.each(config.filters || {}, function(filter, name){
                Twig.extendFilter(name, filter);
            });
            _.each(config.tests || {}, function(test, name){
                Twig.extendTest(name, test);
            });
            Twig.extend(function(Twig) {
                _.each(config.tags || {}, function(tag){
                    Twig.exports.extendTag(tag(Twig));
                });
            });

            const adapter = new TwigAdapter(Twig, source, app, config);

            adapter.setHandlePrefix(config.handlePrefix);

            return adapter;
        }
    }

};
