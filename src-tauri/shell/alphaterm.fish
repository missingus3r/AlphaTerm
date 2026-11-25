# AlphaTerm: shell integration for fish. Loaded with --init-command (after the user's config.fish).
# Emits OSC 133 (prompt/command/end with code), OSC 633;E (command text) and OSC 7 (folder).
if set -q __at_loaded
    exit 0
end
set -g __at_loaded 1

function __at_esc
    string join \n -- $argv | string replace -a '\\' '\\\\' | string replace -a ';' '\\x3b' | string join '\\x0a'
end

function __at_preexec --on-event fish_preexec
    set -g __at_started 1
    printf '\e]633;E;%s\a\e]133;C\a' (__at_esc $argv[1])
end

function __at_postexec --on-event fish_postexec
    set -l ec $status
    if set -q __at_started
        printf '\e]133;D;%s\a' $ec
        set -e __at_started
    end
end

function __at_cwd --on-event fish_prompt
    set -l dir (string replace -a '%' '%25' -- $PWD | string replace -a ' ' '%20')
    printf '\e]7;file://%s%s\a' (prompt_hostname) $dir
end

# The prompt goes between 133;A and 133;B (wrapping whatever prompt the user has).
if functions -q fish_prompt
    functions -c fish_prompt __at_user_prompt
else
    function __at_user_prompt
        printf '%s> ' (prompt_pwd)
    end
end
function __at_return
    return $argv[1]
end
function fish_prompt
    set -l s $status
    printf '\e]133;A\a'
    # The user's prompt may show the last command's status: printf would have reset it.
    __at_return $s
    __at_user_prompt
    printf '\e]133;B\a'
end
