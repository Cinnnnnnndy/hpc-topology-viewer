# GitHub Pages：把 pattern 叠加发布到规范路径

适用场景：站点主体由主分支构建，而 pattern 在一个独立分支上迭代，希望两者一起发布，
且 pattern 拿到 `/patterns/<id>/pattern.html` 这样的规范地址。

## workflow 片段

```yaml
- name: Overlay pattern at /patterns/<id>/ (and keep the legacy alias)
  run: |
    SHA=$(git -C pattern-src rev-parse --short HEAD)
    SRC=pattern-src/public/vendor/<pattern-id>

    # ① 规范入口：pattern.* 同级
    PAT=dist/patterns/<pattern-id>
    mkdir -p $PAT/vendor
    #   把源页面里 "./vendor/<pattern-id>/pattern.css" 改写成 "./pattern.css"
    #   再给所有本地资源追加 ?v=$SHA
    sed -e 's#\./vendor/<pattern-id>/#./#g' \
        -e "s#\(\./\(pattern\.\(js\|css\)\|favicon\.svg\|vendor/[a-z0-9./-]*\.\(js\|css\)\)\)#\1?v=$SHA#g" \
        pattern-src/public/<pattern>.html > $PAT/pattern.html
    cp $SRC/pattern.js $SRC/pattern.css $SRC/pattern.json $SRC/favicon.svg $PAT/
    cp dist/vendor/three-r128.min.js $PAT/vendor/three-r128.min.js
    cp -r pattern-src/public/vendor/pto-design-system $PAT/vendor/pto-design-system
    #   版本落进契约，便于对账
    node -e "const f='$PAT/pattern.json',fs=require('fs');
             const o=JSON.parse(fs.readFileSync(f,'utf8'));o.version='$SHA';
             fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')"

    # ② 旧入口：同一份内容，路径不变（发出去的链接不能失效）
    mkdir -p dist/<legacy>/vendor/<pattern-id>
    sed -e "s#\(\./vendor/[a-z0-9./-]*\.\(js\|css\|svg\)\)#\1?v=$SHA#g" \
        pattern-src/public/<pattern>.html > dist/<legacy>/index.html
    cp $SRC/pattern.js $SRC/pattern.css $SRC/pattern.json $SRC/favicon.svg dist/<legacy>/vendor/<pattern-id>/
    # …vendor 依赖同上
```

## 两个 sed 表达式在做什么

| 表达式 | 作用 |
|---|---|
| `s#\./vendor/<id>/#./#g` | 把「资源在 vendor 子目录」改写成「资源与 html 同级」——只有规范入口需要 |
| `s#\(…\.\(js\|css\)\)#\1?v=$SHA#g` | 给本地资源追加版本戳。注意只匹配 `./` 开头的相对路径，别把外链也戳了 |

`@import` 进来的二级依赖（如设计系统 token）拿不到戳，一般可接受——它们变动频率低；
若必须严格，把 `@import` 展平成显式 `<link>`。

## 整体替换的坑

Pages 每次部署替换**整个站点**。若主分支 workflow 不含这段叠加逻辑：

- 主分支一发布 → `/patterns/<id>/` 与旧入口一起消失；
- 重跑本分支 workflow（push 或 workflow_dispatch 选该分支）即可恢复。

长期方案是把叠加逻辑合并进主分支的 workflow；在此之前，请把这条写进 workflow 顶部注释
与交付说明里，避免别人以为链接坏了。

## 本地演练

推之前先在本地把产物搭出来，用静态服务器验一遍，比等 CI 快得多：

```bash
python3 -m http.server 8179 --directory dist
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8179/patterns/<id>/pattern.html
```
