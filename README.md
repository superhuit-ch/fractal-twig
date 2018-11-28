# Twig Adapter

[WIP] An adapter to let you use [Twig](https://github.com/twigjs/twig.js) templates with [Fractal](http://github.com/frctl/fractal).

This fork from the [official Twig adapter for fractal](https://github.com/frctl/twig) uses a modified adapter.js resulting in an 'include' function that can fix the construction of paths when including components within other components.

## Why is this necessary?

Twig uses a root directory and all includes are based upon that directory.
Including atoms/button.twig from index.twig at the root level would be fine when rendering index.twig.

However, rendering atoms/button.twig from molecules/list.twig would break because the root directory is molecules/list and Twig would try to incude molecules/list/atoms/button/button.twig, resulting in a "Template not found error".

## OK, cool, how do I use this?
You can now prefix your path with a forward slash to avoid the "Template not found" error when including components.

If `include atoms/button/button.twig` returns a "Template not found" error, use

`include /atoms/button/button.twig`. 
