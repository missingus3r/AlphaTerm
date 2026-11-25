# AlphaTerm: shell integration for zsh. AlphaTerm points ZDOTDIR to a folder whose .zshenv and
# .zshrc are this file (`ALPHATERM_ZSH_STAGE` says which one is running): they load the user's own
# files from their real ZDOTDIR and then add the marks.
# Emits OSC 133 (prompt/command/end with code), OSC 633;E (command text) and OSC 7 (folder).

if [[ "$ALPHATERM_ZSH_STAGE" == env ]]; then
  # .zshenv: the user's one, with their ZDOTDIR; then ZDOTDIR points here again so zsh reads our .zshrc.
  __at_dot=$ZDOTDIR
  ZDOTDIR=${ALPHATERM_USER_ZDOTDIR:-$HOME}
  [[ -r "$ZDOTDIR/.zshenv" ]] && builtin source "$ZDOTDIR/.zshenv"
  ALPHATERM_USER_ZDOTDIR=$ZDOTDIR
  ZDOTDIR=$__at_dot
  unset __at_dot
  ALPHATERM_ZSH_STAGE=rc
  return 0
fi

# .zshrc: from here on ZDOTDIR is the user's again (their plugins and history files rely on it).
ZDOTDIR=${ALPHATERM_USER_ZDOTDIR:-$HOME}
unset ALPHATERM_USER_ZDOTDIR ALPHATERM_ZSH_STAGE
[[ -r "$ZDOTDIR/.zshrc" ]] && builtin source "$ZDOTDIR/.zshrc"

__at_esc() {
  local s=${1//\\/\\\\}
  s=${s//;/\\x3b}
  s=${s//$'\n'/\\x0a}
  builtin printf '%s' "$s"
}

__at_preexec() {
  __at_started=1
  builtin printf '\e]633;E;%s\a\e]133;C\a' "$(__at_esc "$1")"
}

__at_precmd() {
  local ec=$?
  if [[ -n "$__at_started" ]]; then builtin printf '\e]133;D;%s\a' "$ec"; fi
  __at_started=
  local dir=${PWD//\%/%25}
  builtin printf '\e]7;file://%s%s\a' "${HOST:-localhost}" "${dir// /%20}"
}

# Last of all the precmd hooks: prompt themes that rebuild PS1 every time run before it.
__at_wrap_ps1() {
  [[ "$PS1" == *'133;A'* ]] || PS1=$'%{\e]133;A\a%}'"$PS1"$'%{\e]133;B\a%}'
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec __at_preexec
precmd_functions=(__at_precmd ${precmd_functions:#__at_precmd} __at_wrap_ps1)
